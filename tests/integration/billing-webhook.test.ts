/**
 * Stripe Webhook イベント同期の統合テスト（実DB）。
 * processStripeEvent がテナントの課金状態・契約履歴を正しく同期すること。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { processStripeEvent } from '@/server/billing/billing-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
let tenantId: string;
let planId: string;
const CUS = 'cus_test_billing_1';
const SUB = 'sub_test_billing_1';
const PRICE = 'price_test_billing_1';

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  tenantId = sc.tenantId;
  const plan = await prisma.plan.upsert({
    where: { code: `test-billing-${sc.tenantId.slice(-8)}` },
    update: { stripePriceId: PRICE },
    create: {
      code: `test-billing-${sc.tenantId.slice(-8)}`,
      name: 'テスト課金プラン',
      priceJpy: 5000,
      stripePriceId: PRICE,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

function subEvent(type: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    type,
    data: {
      object: {
        id: SUB,
        customer: CUS,
        status,
        current_period_end: 1_790_000_000,
        metadata: { tenantId },
        items: { data: [{ price: { id: PRICE } }] },
        ...extra,
      },
    },
  };
}

describe('processStripeEvent', () => {
  it('checkout.session.completed: 顧客IDとサブスクIDをテナントへ紐付け', async () => {
    await processStripeEvent({
      type: 'checkout.session.completed',
      data: { object: { customer: CUS, subscription: SUB, metadata: { tenantId } } },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeCustomerId: true, stripeSubscriptionId: true },
    });
    expect(t).toMatchObject({ stripeCustomerId: CUS, stripeSubscriptionId: SUB });
  });

  it('subscription.created(active): 状態・期間・プランを同期し履歴を作成', async () => {
    await processStripeEvent(subEvent('customer.subscription.created', 'active'));
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionStatus: true, currentPeriodEnd: true, planId: true },
    });
    expect(t?.stripeSubscriptionStatus).toBe('active');
    expect(t?.planId).toBe(planId);
    expect(t?.currentPeriodEnd?.getTime()).toBe(1_790_000_000 * 1000);

    const hist = await prisma.subscription.findFirst({ where: { externalRef: SUB } });
    expect(hist).toMatchObject({ tenantId, planId, status: 'ACTIVE' });
  });

  it('同一イベント再送は冪等（履歴が増えない）', async () => {
    await processStripeEvent(subEvent('customer.subscription.updated', 'active'));
    await processStripeEvent(subEvent('customer.subscription.updated', 'active'));
    const count = await prisma.subscription.count({ where: { externalRef: SUB } });
    expect(count).toBe(1);
  });

  it('invoice.payment_failed: past_due へ', async () => {
    await processStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: CUS } },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionStatus: true },
    });
    expect(t?.stripeSubscriptionStatus).toBe('past_due');
  });

  it('subscription.deleted: canceled へ・履歴も CANCELLED', async () => {
    await processStripeEvent(subEvent('customer.subscription.deleted', 'canceled'));
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionStatus: true },
    });
    expect(t?.stripeSubscriptionStatus).toBe('canceled');
    const hist = await prisma.subscription.findFirst({ where: { externalRef: SUB } });
    expect(hist?.status).toBe('CANCELLED');
    expect(hist?.expiresAt).not.toBeNull();
  });

  it('payment_failed は canceled を復活させない（アクセス許可ステータスへ巻き戻さない）', async () => {
    // 直前のテストで canceled になっている
    await processStripeEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: CUS } },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionStatus: true },
    });
    expect(t?.stripeSubscriptionStatus).toBe('canceled');
  });

  it('再契約: 新サブスクが active になった後、旧サブスクの deleted 遅延到着は無視される', async () => {
    const T2 = 1_790_100_000;
    // 新サブスク sub_2 が active（イベント時刻 T2）
    await processStripeEvent({
      type: 'customer.subscription.created',
      created: T2,
      data: {
        object: {
          id: 'sub_test_billing_2',
          customer: CUS,
          status: 'active',
          current_period_end: 1_795_000_000,
          metadata: { tenantId },
          items: { data: [{ price: { id: PRICE } }] },
        },
      },
    });
    // 旧サブスク SUB の deleted が遅れて再送される（T2 より古い時刻）
    await processStripeEvent({
      type: 'customer.subscription.deleted',
      created: T2 - 500,
      data: {
        object: {
          id: SUB,
          customer: CUS,
          status: 'canceled',
          metadata: { tenantId },
          items: { data: [{ price: { id: PRICE } }] },
        },
      },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionId: true, stripeSubscriptionStatus: true },
    });
    // 支払中のテナントはロックされない
    expect(t).toMatchObject({ stripeSubscriptionId: 'sub_test_billing_2', stripeSubscriptionStatus: 'active' });
  });

  it('番兵より古い updated イベントは状態を巻き戻さない', async () => {
    await processStripeEvent({
      type: 'customer.subscription.updated',
      created: 1_790_000_001, // 上の T2 より古い
      data: {
        object: {
          id: 'sub_test_billing_2',
          customer: CUS,
          status: 'past_due',
          metadata: { tenantId },
          items: { data: [{ price: { id: PRICE } }] },
        },
      },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { stripeSubscriptionStatus: true },
    });
    expect(t?.stripeSubscriptionStatus).toBe('active');
  });

  it('Basil API（period が items 側）でも次回更新日時を同期できる', async () => {
    const T3 = 1_790_200_000;
    await processStripeEvent({
      type: 'customer.subscription.updated',
      created: T3,
      data: {
        object: {
          id: 'sub_test_billing_2',
          customer: CUS,
          status: 'active',
          metadata: { tenantId },
          items: { data: [{ price: { id: PRICE }, current_period_end: 1_796_000_000 }] },
        },
      },
    });
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currentPeriodEnd: true },
    });
    expect(t?.currentPeriodEnd?.getTime()).toBe(1_796_000_000 * 1000);
  });

  it('未知のテナント/イベントは無視して例外を出さない', async () => {
    await expect(
      processStripeEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_x', customer: 'cus_unknown', status: 'active' } },
      }),
    ).resolves.toBeUndefined();
    await expect(
      processStripeEvent({ type: 'some.unknown.event', data: { object: {} } }),
    ).resolves.toBeUndefined();
  });
});
