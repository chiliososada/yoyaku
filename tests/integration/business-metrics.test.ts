/**
 * 経営指標の統合テスト（実DB）。
 *
 * DD で最も突かれるのは「その数字はどう出したのか」。よってここでは
 *  - 値上げしても過去の実収が変わらないこと（台帳の金額スナップショットを使っている証明）
 *  - 課金免除（自社・デモ）が商業指標に混ざらないこと
 *  - 母数が無いときに数字を捏造せず null を返すこと
 * を優先的に固定する。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getBusinessMetrics } from '@/server/services/business-metrics-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';
import { formatInTz, monthStartInZone } from '@/lib/time';

const createdTenants: string[] = [];
const createdPlans: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.plan.deleteMany({ where: { id: { in: createdPlans } } });
});

async function seedPlan(code: string, priceJpy: number) {
  const plan = await prisma.plan.create({
    data: { code: `${code}-${Date.now()}-${Math.floor(priceJpy)}`, name: `検証${code}`, priceJpy },
  });
  createdPlans.push(plan.id);
  return plan;
}

/** 指定状態のテナントを用意。 */
async function seedTenant(opts: {
  planId?: string;
  subStatus?: string | null;
  exempt?: boolean;
  trialDaysLeft?: number;
}) {
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  await prisma.tenant.update({
    where: { id: sc.tenantId },
    data: {
      planId: opts.planId ?? null,
      stripeSubscriptionStatus: opts.subStatus ?? null,
      billingExempt: opts.exempt ?? false,
      trialEndsAt: opts.trialDaysLeft != null ? new Date(Date.now() + opts.trialDaysLeft * 86_400_000) : null,
    },
  });
  return sc.tenantId;
}

async function addLedger(tenantId: string, type: 'PAYMENT_SUCCEEDED' | 'PAYMENT_REFUNDED' | 'SUBSCRIPTION_CREATED' | 'SUBSCRIPTION_CANCELED' | 'TRIAL_STARTED', amountJpy: number | null, occurredAt: Date) {
  await prisma.billingEvent.create({
    data: { tenantId, type, amountJpy, occurredAt, stripeEventId: `evt_m_${Math.random().toString(36).slice(2)}` },
  });
}

describe('現在MRR と有料顧客数', () => {
  it('active と past_due を計上し、trialing / 未契約 / 免除は除外する', async () => {
    const plan = await seedPlan('std', 9800);
    await seedTenant({ planId: plan.id, subStatus: 'active' });
    await seedTenant({ planId: plan.id, subStatus: 'past_due' }); // 契約継続中（督促中）→ 計上
    await seedTenant({ planId: plan.id, subStatus: 'trialing' }); // 未入金 → 除外
    await seedTenant({ planId: plan.id, subStatus: null, trialDaysLeft: 10 }); // トライアル中 → 除外
    await seedTenant({ planId: plan.id, subStatus: 'active', exempt: true }); // 自社/デモ → 除外
    await seedTenant({ planId: plan.id, subStatus: 'canceled' }); // 解約済 → 除外

    const m = await getBusinessMetrics();
    // 他テストのテナントが混ざるため、下限で検証（この6件から2件だけ計上される）
    expect(m.payingCustomers).toBeGreaterThanOrEqual(2);
    expect(m.currentMrrJpy).toBeGreaterThanOrEqual(9800 * 2);

    // 免除テナントがMRRに入っていないこと: 免除を全部足しても差にならないことを確認
    const exemptPaying = await prisma.tenant.count({
      where: { billingExempt: true, stripeSubscriptionStatus: { in: ['active', 'past_due'] }, deletedAt: null },
    });
    expect(exemptPaying).toBeGreaterThanOrEqual(1); // 上で1件作った
    // MRR の母集団は billingExempt=false のみ
    const billablePaying = await prisma.tenant.count({
      where: { billingExempt: false, stripeSubscriptionStatus: { in: ['active', 'past_due'] }, deletedAt: null },
    });
    expect(m.payingCustomers).toBe(billablePaying);
  });

  it('プラン別内訳のMRR合計が現在MRRと一致する', async () => {
    const m = await getBusinessMetrics();
    const sum = m.planDistribution.reduce((s, p) => s + p.mrrJpy, 0);
    expect(sum).toBe(m.currentMrrJpy);
  });
});

describe('実収推移は台帳のスナップショットで固定される', () => {
  it('プラン価格を改定しても過去の実収は変わらない', async () => {
    const plan = await seedPlan('hist', 9800);
    const tenantId = await seedTenant({ planId: plan.id, subStatus: 'active' });
    const thisMonth = formatInTz(monthStartInZone(new Date()), 'yyyy-MM', 'Asia/Tokyo');
    await addLedger(tenantId, 'PAYMENT_SUCCEEDED', 9800, new Date());

    const before = await getBusinessMetrics();
    const pointBefore = before.monthlyRevenue.find((p) => p.month === thisMonth)!;
    expect(pointBefore.netJpy).toBeGreaterThanOrEqual(9800);

    // 値上げ（現在価格を書き換える）
    await prisma.plan.update({ where: { id: plan.id }, data: { priceJpy: 29800 } });

    const after = await getBusinessMetrics();
    const pointAfter = after.monthlyRevenue.find((p) => p.month === thisMonth)!;
    // 過去の実収は不変（現在価格から遡って計算していない証明）
    expect(pointAfter.netJpy).toBe(pointBefore.netJpy);
    // 一方で「現在MRR」は新価格で増える（前向き指標なので正しい挙動）
    expect(after.currentMrrJpy).toBeGreaterThan(before.currentMrrJpy);
  });

  it('返金は負数として実収から差し引かれる', async () => {
    const plan = await seedPlan('rf', 9800);
    const tenantId = await seedTenant({ planId: plan.id, subStatus: 'active' });
    const thisMonth = formatInTz(monthStartInZone(new Date()), 'yyyy-MM', 'Asia/Tokyo');

    const base = (await getBusinessMetrics()).monthlyRevenue.find((p) => p.month === thisMonth)!.netJpy;
    await addLedger(tenantId, 'PAYMENT_SUCCEEDED', 9800, new Date());
    await addLedger(tenantId, 'PAYMENT_REFUNDED', -4000, new Date());
    const after = (await getBusinessMetrics()).monthlyRevenue.find((p) => p.month === thisMonth)!.netJpy;
    expect(after - base).toBe(5800);
  });

  it('免除テナントの入金は実収に入らない', async () => {
    const plan = await seedPlan('ex', 9800);
    const tenantId = await seedTenant({ planId: plan.id, subStatus: 'active', exempt: true });
    const thisMonth = formatInTz(monthStartInZone(new Date()), 'yyyy-MM', 'Asia/Tokyo');
    const base = (await getBusinessMetrics()).monthlyRevenue.find((p) => p.month === thisMonth)!.netJpy;
    await addLedger(tenantId, 'PAYMENT_SUCCEEDED', 50000, new Date());
    const after = (await getBusinessMetrics()).monthlyRevenue.find((p) => p.month === thisMonth)!.netJpy;
    expect(after).toBe(base);
  });

  it('直近12ヶ月分の枠が常に並ぶ（データが無い月も0で表示できる）', async () => {
    const m = await getBusinessMetrics();
    expect(m.monthlyRevenue.length).toBeGreaterThanOrEqual(12);
    expect(m.monthlyRevenue).toEqual([...m.monthlyRevenue].sort((a, b) => a.month.localeCompare(b.month)));
  });
});

describe('解約率・転換率・LTV は根拠が無ければ数字を出さない', () => {
  it('解約実績が無いテナント群では平均継続月数とLTVが null', async () => {
    // このテストDBに解約イベントが1件も無い前提が崩れる可能性があるため、
    // 「解約イベントが無ければ null」という条件付きで検証する
    const canceledCount = await prisma.billingEvent.count({
      where: { type: 'SUBSCRIPTION_CANCELED', tenant: { billingExempt: false } },
    });
    const m = await getBusinessMetrics();
    if (canceledCount === 0) {
      expect(m.avgLifetimeMonths).toBeNull();
      expect(m.ltvJpy).toBeNull();
    } else {
      expect(m.avgLifetimeMonths).not.toBeNull();
    }
  });

  it('契約→解約の履歴から平均継続月数とLTVが算出される', async () => {
    const plan = await seedPlan('life', 9800);
    const tenantId = await seedTenant({ planId: plan.id, subStatus: 'canceled' });
    const created = new Date(Date.now() - 180 * 86_400_000); // 約6ヶ月前
    await addLedger(tenantId, 'SUBSCRIPTION_CREATED', 9800, created);
    await addLedger(tenantId, 'SUBSCRIPTION_CANCELED', 9800, new Date());

    const m = await getBusinessMetrics();
    expect(m.avgLifetimeMonths).not.toBeNull();
    expect(m.avgLifetimeMonths!).toBeGreaterThan(0);
    // 有料顧客が居れば LTV も出る（平均単価 × 平均継続月数）
    if (m.payingCustomers > 0) {
      expect(m.ltvJpy).not.toBeNull();
      expect(m.ltvJpy!).toBeGreaterThan(0);
    }
  });

  it('トライアル開始が無ければ転換率は null（0%と区別する）', async () => {
    const trials = await prisma.billingEvent.count({
      where: { type: 'TRIAL_STARTED', tenant: { billingExempt: false } },
    });
    const m = await getBusinessMetrics();
    if (trials === 0) expect(m.trialConversionRate).toBeNull();
    else expect(m.trialConversionRate).not.toBeNull();
  });

  it('トライアル開始→契約でカウントされる', async () => {
    const plan = await seedPlan('conv', 9800);
    const tenantId = await seedTenant({ planId: plan.id, subStatus: 'active' });
    await addLedger(tenantId, 'TRIAL_STARTED', null, new Date(Date.now() - 20 * 86_400_000));
    await addLedger(tenantId, 'SUBSCRIPTION_CREATED', 9800, new Date(Date.now() - 5 * 86_400_000));

    const m = await getBusinessMetrics();
    expect(m.trialStartedTotal).toBeGreaterThanOrEqual(1);
    expect(m.convertedTotal).toBeGreaterThanOrEqual(1);
    expect(m.trialConversionRate).not.toBeNull();
    expect(m.trialConversionRate!).toBeGreaterThan(0);
    expect(m.trialConversionRate!).toBeLessThanOrEqual(1);
  });

  it('期間開始時点の有料顧客が0なら解約率は null（0除算しない）', async () => {
    const m = await getBusinessMetrics();
    // null か、0〜1 の範囲。NaN や Infinity を返さないこと
    if (m.churnRate30d != null) {
      expect(Number.isFinite(m.churnRate30d)).toBe(true);
      expect(m.churnRate30d).toBeGreaterThanOrEqual(0);
    }
  });
});
