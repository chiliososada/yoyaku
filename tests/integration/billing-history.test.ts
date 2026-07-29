/**
 * 課金台帳（billing_events）と Phase 0 の不変条件の統合テスト（実DB）。
 *
 * ここで守りたいのは「後から作り直せないもの」:
 *  - 状態遷移が**上書きされず全て残る**こと（trial→active→past_due→canceled）
 *  - 金額が**発生時点でスナップショット**され、後の価格改定で過去が書き換わらないこと
 *  - Webhook 再送で二重計上しないこと
 *  - 解約が tenant.status に反映され、集計可能であること
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { processStripeEvent, remainingTrialDays, startCheckout } from '@/server/billing/billing-service';
import { isAppError, type AppError } from '@/lib/errors';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
let tenantId: string;
let planId: string;
let planId2: string;
/** 後片付け用（各テストが独自に作るプラン） */
const createdPlans: string[] = [];
const CUS = 'cus_hist_1';
const SUB = 'sub_hist_1';
const PRICE = 'price_hist_1';
const PRICE2 = 'price_hist_2';

/**
 * 単調増加する擬似 Stripe タイムスタンプ。
 * billing-service は lastStripeEventAt より古いイベントを「遅延再送」として捨てるため、
 * テストのイベントは必ず時系列順に発行する必要がある。
 */
let clock = Math.floor(Date.now() / 1000) - 3600;
function nextTs(): number {
  clock += 10;
  return clock;
}

/** Stripe イベントの最小形。 */
function subEvent(type: string, status: string, opts?: { id?: string; created?: number; price?: string }) {
  return {
    id: opts?.id ?? `evt_${type}_${status}_${Math.random().toString(36).slice(2)}`,
    type,
    created: opts?.created ?? nextTs(),
    data: {
      object: {
        id: SUB,
        customer: CUS,
        status,
        metadata: { tenantId },
        items: { data: [{ price: { id: opts?.price ?? PRICE }, current_period_end: 1900000000 }] },
      } as Record<string, unknown>,
    },
  };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  tenantId = sc.tenantId;

  const suffix = tenantId.slice(-8);
  const p1 = await prisma.plan.create({
    data: { code: `hist-std-${suffix}`, name: 'テスト標準', priceJpy: 4980, stripePriceId: PRICE },
  });
  const p2 = await prisma.plan.create({
    data: { code: `hist-pro-${suffix}`, name: 'テストプロ', priceJpy: 29800, stripePriceId: PRICE2 },
  });
  planId = p1.id;
  planId2 = p2.id;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeCustomerId: CUS, billingExempt: false, planId },
  });
});

afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.plan.deleteMany({ where: { id: { in: [planId, planId2, ...createdPlans].filter(Boolean) } } });
});

describe('課金台帳: 全遷移が追記され、上書きされない', () => {
  it('trial→active→past_due→canceled の4遷移がすべて残る', async () => {
    await processStripeEvent(subEvent('customer.subscription.created', 'trialing'));
    await processStripeEvent(subEvent('customer.subscription.updated', 'active'));
    await processStripeEvent({
      id: 'evt_fail_1',
      type: 'invoice.payment_failed',
      created: nextTs(),
      data: { object: { id: 'in_1', customer: CUS, subscription: SUB } },
    });
    await processStripeEvent(subEvent('customer.subscription.deleted', 'canceled'));

    const events = await prisma.billingEvent.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'asc' },
      select: { type: true, fromStatus: true, toStatus: true, amountJpy: true, planName: true },
    });

    // TRIAL_STARTED はテナント作成経路で入るためここには無い。Stripe 由来の4件を検証。
    const types = events.map((e) => e.type);
    expect(types).toContain('SUBSCRIPTION_CREATED');
    expect(types).toContain('SUBSCRIPTION_UPDATED');
    expect(types).toContain('PAYMENT_FAILED');
    expect(types).toContain('SUBSCRIPTION_CANCELED');
    expect(events.length).toBeGreaterThanOrEqual(4);

    // 遷移が「上書き」ではなく履歴として残っている
    const canceled = events.find((e) => e.type === 'SUBSCRIPTION_CANCELED');
    expect(canceled?.toStatus).toBe('canceled');
    // 金額はプランからスナップショットされている
    expect(canceled?.amountJpy).toBe(4980);
    expect(canceled?.planName).toBe('テスト標準');
  });

  it('価格を改定しても過去のイベントの金額は変わらない（スナップショット）', async () => {
    const before = await prisma.billingEvent.findFirst({
      where: { tenantId, amountJpy: { not: null } },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, amountJpy: true },
    });
    expect(before?.amountJpy).toBe(4980);

    // 値上げ（Plan.priceJpy を原地更新）
    await prisma.plan.update({ where: { id: planId }, data: { priceJpy: 9800 } });

    const after = await prisma.billingEvent.findUnique({
      where: { id: before!.id },
      select: { amountJpy: true, planName: true },
    });
    // 過去の記録は 4980 のまま（JOIN 復元だとここが 9800 に化けてMRR履歴が壊れる）
    expect(after?.amountJpy).toBe(4980);
  });

  it('同一 Stripe イベントの再送で二重計上しない', async () => {
    const ev = subEvent('customer.subscription.updated', 'active', { id: 'evt_dup_1' });
    await processStripeEvent(ev);
    const n1 = await prisma.billingEvent.count({ where: { stripeEventId: 'evt_dup_1' } });
    await processStripeEvent(ev);
    const n2 = await prisma.billingEvent.count({ where: { stripeEventId: 'evt_dup_1' } });
    expect(n1).toBe(1);
    expect(n2).toBe(1);
  });

  it('invoice.paid で実入金額が記録される', async () => {
    await processStripeEvent({
      id: 'evt_paid_1',
      type: 'invoice.paid',
      created: nextTs(),
      data: { object: { id: 'in_paid_1', customer: CUS, subscription: SUB, amount_paid: 4980, currency: 'jpy' } },
    });
    const paid = await prisma.billingEvent.findFirst({
      where: { tenantId, type: 'PAYMENT_SUCCEEDED' },
      select: { amountJpy: true, stripeInvoiceId: true },
    });
    expect(paid?.amountJpy).toBe(4980);
    expect(paid?.stripeInvoiceId).toBe('in_paid_1');
  });

  it('プラン変更が PLAN_CHANGED として記録される', async () => {
    // 現在の紐付けを active に戻してからプラン変更
    await processStripeEvent(subEvent('customer.subscription.updated', 'active', { price: PRICE }));
    await processStripeEvent(subEvent('customer.subscription.updated', 'active', { price: PRICE2 }));
    const changed = await prisma.billingEvent.findFirst({
      where: { tenantId, type: 'PLAN_CHANGED' },
      orderBy: { occurredAt: 'desc' },
      select: { planName: true, amountJpy: true },
    });
    expect(changed?.planName).toBe('テストプロ');
    expect(changed?.amountJpy).toBe(29800);
  });
});

describe('初回契約の分類（FIX-B #7）', () => {
  it('checkout が incomplete を先置きし、契約プランが trial の planId と異なっても初回は SUBSCRIPTION_CREATED', async () => {
    // 再現条件: トライアル planId=pA のテナントが、checkout 完了で incomplete を先に立て、
    // その後 別プラン pB の subscription.created が届く。旧実装では
    //  - planChanged (pB≠pA) が created より先に評価 → PLAN_CHANGED
    //  - あるいは incomplete 済みのため UPDATED
    // に化けていた。初回契約は必ず CREATED であるべき。
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const suffix = sc.tenantId.slice(-8);
    const priceA = `price_firstA_${suffix}`;
    const priceB = `price_firstB_${suffix}`;
    const pA = await prisma.plan.create({ data: { code: `firstA-${suffix}`, name: '初回A', priceJpy: 9800, stripePriceId: priceA } });
    const pB = await prisma.plan.create({ data: { code: `firstB-${suffix}`, name: '初回B', priceJpy: 29800, stripePriceId: priceB } });
    createdPlans.push(pA.id, pB.id);
    const cus = `cus_first_${suffix}`;
    const sub = `sub_first_${suffix}`;
    // トライアル中: planId=pA、まだ Stripe サブスク未同期
    await prisma.tenant.update({
      where: { id: sc.tenantId },
      data: { stripeCustomerId: cus, billingExempt: false, planId: pA.id },
    });

    // 1) checkout.session.completed → incomplete を先置き
    await processStripeEvent({
      id: `evt_co_${suffix}`,
      type: 'checkout.session.completed',
      created: nextTs(),
      data: { object: { customer: cus, subscription: sub, metadata: { tenantId: sc.tenantId } } },
    });
    const afterCheckout = await prisma.tenant.findUniqueOrThrow({
      where: { id: sc.tenantId }, select: { stripeSubscriptionStatus: true },
    });
    expect(afterCheckout.stripeSubscriptionStatus).toBe('incomplete');

    // 2) 別プラン pB の subscription.created（active）
    await processStripeEvent({
      id: `evt_first_created_${suffix}`,
      type: 'customer.subscription.created',
      created: nextTs(),
      data: {
        object: {
          id: sub, customer: cus, status: 'active', metadata: { tenantId: sc.tenantId },
          items: { data: [{ price: { id: priceB }, current_period_end: 1900000000 }] },
        } as Record<string, unknown>,
      },
    });

    const ev = await prisma.billingEvent.findMany({
      where: { tenantId: sc.tenantId, stripeSubscriptionId: sub },
      select: { type: true, planName: true },
    });
    const types = ev.map((e) => e.type);
    expect(types).toContain('SUBSCRIPTION_CREATED');
    expect(types).not.toContain('PLAN_CHANGED');
    // 金額/プランは実際に契約した pB でスナップショットされる
    const created = ev.find((e) => e.type === 'SUBSCRIPTION_CREATED');
    expect(created?.planName).toBe('初回B');
  });

  it('契約後の updated で別プランに変わると PLAN_CHANGED（created の後は従来どおり）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const suffix = sc.tenantId.slice(-8);
    const priceA = `price_upA_${suffix}`;
    const priceB = `price_upB_${suffix}`;
    const pA = await prisma.plan.create({ data: { code: `upA-${suffix}`, name: '変更前', priceJpy: 9800, stripePriceId: priceA } });
    const pB = await prisma.plan.create({ data: { code: `upB-${suffix}`, name: '変更後', priceJpy: 29800, stripePriceId: priceB } });
    createdPlans.push(pA.id, pB.id);
    const cus = `cus_up_${suffix}`;
    const sub = `sub_up_${suffix}`;
    await prisma.tenant.update({
      where: { id: sc.tenantId },
      data: { stripeCustomerId: cus, billingExempt: false, planId: pA.id },
    });
    const mk = (type: string, price: string, id: string) => ({
      id, type, created: nextTs(),
      data: { object: {
        id: sub, customer: cus, status: 'active', metadata: { tenantId: sc.tenantId },
        items: { data: [{ price: { id: price }, current_period_end: 1900000000 }] },
      } as Record<string, unknown> },
    });
    await processStripeEvent(mk('customer.subscription.created', priceA, `evt_upc_${suffix}`));
    await processStripeEvent(mk('customer.subscription.updated', priceB, `evt_upu_${suffix}`));
    const changed = await prisma.billingEvent.findFirst({
      where: { tenantId: sc.tenantId, type: 'PLAN_CHANGED' },
      select: { planName: true },
    });
    expect(changed?.planName).toBe('変更後');
  });
});

describe('解約が集計可能になっている', () => {
  it('解約で tenant.status が CANCELLED に遷移する', async () => {
    await processStripeEvent(subEvent('customer.subscription.deleted', 'canceled'));
    const t = await prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { status: true, stripeSubscriptionStatus: true },
    });
    expect(t.status).toBe('CANCELLED');
    expect(t.stripeSubscriptionStatus).toBe('canceled');
  });
});

describe('二重契約の防止（二重課金は取り返しがつかない）', () => {
  it('Checkout 完了〜Webhook 同期の隙間で二本目を作らせない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const plan = await prisma.plan.create({
      data: { code: `dbl-${sc.tenantId.slice(-8)}`, name: '二重防止', priceJpy: 9800, stripePriceId: `price_dbl_${sc.tenantId.slice(-8)}` },
    });
    createdPlans.push(plan.id);

    // Checkout 完了直後の状態を再現: サブスクIDはあるが status はまだ同期されていない
    await prisma.tenant.update({
      where: { id: sc.tenantId },
      data: {
        planId: plan.id,
        billingExempt: false,
        stripeCustomerId: `cus_dbl_${sc.tenantId.slice(-8)}`,
        stripeSubscriptionId: 'sub_inflight_1',
        stripeSubscriptionStatus: null,
        trialEndsAt: new Date(Date.now() - 86_400_000), // トライアル切れ = LOCKED 表示
      },
    });

    await expect(startCheckout(sc.tenantId, plan.id)).rejects.toThrow();
    try {
      await startCheckout(sc.tenantId, plan.id);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as AppError).userMessage).toContain('処理中');
    }
  });

  it("'incomplete'（決済確定待ち）でも二本目を作らせない", async () => {
    const t = await prisma.tenant.findFirstOrThrow({ where: { stripeSubscriptionId: 'sub_inflight_1' }, select: { id: true, planId: true } });
    await prisma.tenant.update({ where: { id: t.id }, data: { stripeSubscriptionStatus: 'incomplete' } });
    await expect(startCheckout(t.id, t.planId!)).rejects.toThrow();
  });

  it('解約後の再契約は通す（canceled は完全終了）', async () => {
    const t = await prisma.tenant.findFirstOrThrow({ where: { stripeSubscriptionId: 'sub_inflight_1' }, select: { id: true, planId: true } });
    await prisma.tenant.update({ where: { id: t.id }, data: { stripeSubscriptionStatus: 'canceled' } });
    // Stripe 未設定のテスト環境では、ガードを通過したあと決済API呼び出しの手前で落ちる。
    // ここで確かめたいのは「二重申込ガードに弾かれていない」ことなので、
    // 失敗はしてよいが、その理由が『処理中』であってはならない。
    let message = '';
    try {
      await startCheckout(t.id, t.planId!);
    } catch (e) {
      message = isAppError(e) ? e.userMessage : String((e as Error).message);
    }
    expect(message).not.toContain('処理中');
  });
});

describe('同一秒イベントで支払い済みテナントをロックしない', () => {
  it('active の後に同秒の incomplete が来ても後退させない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const suffix = sc.tenantId.slice(-8);
    const price = `price_race_${suffix}`;
    const plan = await prisma.plan.create({
      data: { code: `race-${suffix}`, name: '競合テスト', priceJpy: 9800, stripePriceId: price },
    });
    createdPlans.push(plan.id);
    const cus = `cus_race_${suffix}`;
    const sub = `sub_race_${suffix}`;
    await prisma.tenant.update({
      where: { id: sc.tenantId },
      data: { stripeCustomerId: cus, billingExempt: false, planId: plan.id },
    });

    const ts = Math.floor(Date.now() / 1000);
    const mk = (status: string, id: string) => ({
      id,
      type: 'customer.subscription.updated',
      created: ts, // 同一秒
      data: {
        object: {
          id: sub,
          customer: cus,
          status,
          metadata: { tenantId: sc.tenantId },
          items: { data: [{ price: { id: price }, current_period_end: 1900000000 }] },
        } as Record<string, unknown>,
      },
    });

    // 先に active が適用され、その後 同秒の incomplete が遅れて届く
    await processStripeEvent(mk('active', `evt_race_a_${suffix}`));
    await processStripeEvent(mk('incomplete', `evt_race_b_${suffix}`));

    const t = await prisma.tenant.findUniqueOrThrow({
      where: { id: sc.tenantId },
      select: { stripeSubscriptionStatus: true },
    });
    // 支払い済みなのにロックされる、が起きないこと
    expect(t.stripeSubscriptionStatus).toBe('active');
  });
});

describe('トライアル残日数の引継ぎ', () => {
  it('残日数を切り上げで返し、期限切れ・未設定は0', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    expect(remainingTrialDays(new Date('2026-07-28T00:00:00Z'), now)).toBe(27);
    expect(remainingTrialDays(new Date('2026-07-01T12:00:00Z'), now)).toBe(1); // 端数は切り上げ
    expect(remainingTrialDays(new Date('2026-06-30T00:00:00Z'), now)).toBe(0); // 期限切れ
    expect(remainingTrialDays(null, now)).toBe(0);
  });
});
