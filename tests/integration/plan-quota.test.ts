/**
 * プラン上限の強制（ティア課金の根拠）の統合テスト（実DB）。
 *
 * 設計上の要点:
 *  - スタッフ上限は商家側の操作なので**その場で拒否**してよい
 *  - 予約上限は超過しても猶予帯までは通す（顧客の予約を止めると商家の営業損失になる）
 *  - 課金免除テナントは常に無制限
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createStaff } from '@/server/services/merchant-mutation-service';
import { assertPublicBookingQuota, getBookingQuotaUsage } from '@/server/services/billing-quota-service';
import { isAppError, type AppError } from '@/lib/errors';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
const createdPlans: string[] = [];

function staffInput(name: string) {
  return {
    name,
    displayName: '',
    email: '',
    phone: '',
    bio: '',
    isBookable: true,
    capacity: 1,
    nominationFeeJpy: 0,
    status: 'ACTIVE' as const,
    sortOrder: 0,
    serviceIds: [],
  };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.plan.deleteMany({ where: { id: { in: createdPlans } } });
});

describe('スタッフ上限（maxStaffPerShop）', () => {
  it('上限に達すると追加できず、上位プランへの案内が出る', async () => {
    const sc = await seedScenario({ staffCount: 1 }); // 既に1名いる
    createdTenants.push(sc.tenantId);
    const plan = await prisma.plan.create({
      data: { code: `quota-staff-${sc.tenantId.slice(-8)}`, name: 'テスト小規模', priceJpy: 4980, maxStaffPerShop: 2 },
    });
    createdPlans.push(plan.id);
    await prisma.tenant.update({ where: { id: sc.tenantId }, data: { planId: plan.id } });

    // 2人目は入る（上限2）
    await createStaff(sc.tenantId, sc.shopId, staffInput('2人目'));

    // 3人目は拒否
    await expect(createStaff(sc.tenantId, sc.shopId, staffInput('3人目'))).rejects.toThrow();
    try {
      await createStaff(sc.tenantId, sc.shopId, staffInput('3人目'));
      throw new Error('should have thrown');
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      const msg = (e as AppError).userMessage;
      expect(msg).toContain('2名');
      expect(msg).toContain('テスト小規模');
    }

    const count = await prisma.staff.count({ where: { shopId: sc.shopId, deletedAt: null } });
    expect(count).toBe(2);
  });
});

describe('月間予約上限（maxBookingsPerMonth）', () => {
  it('上限内では通り、使用量が読める', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const plan = await prisma.plan.create({
      data: { code: `quota-bk-${sc.tenantId.slice(-8)}`, name: 'テスト予約枠', priceJpy: 4980, maxBookingsPerMonth: 10 },
    });
    createdPlans.push(plan.id);
    await prisma.tenant.update({
      where: { id: sc.tenantId },
      data: { planId: plan.id, billingExempt: false },
    });

    const usage = await getBookingQuotaUsage(sc.tenantId);
    expect(usage.limit).toBe(10);
    expect(usage.planName).toBe('テスト予約枠');
    await expect(assertPublicBookingQuota(sc.tenantId)).resolves.toBeUndefined();
  });

  it('上限超過でも猶予帯（110%未満）は通す＝顧客の予約を即座には止めない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const plan = await prisma.plan.create({
      data: { code: `quota-grace-${sc.tenantId.slice(-8)}`, name: 'テスト猶予', priceJpy: 4980, maxBookingsPerMonth: 10 },
    });
    createdPlans.push(plan.id);
    await prisma.tenant.update({ where: { id: sc.tenantId }, data: { planId: plan.id, billingExempt: false } });

    // ちょうど上限（10件）→ 猶予帯なので通る
    await seedBookings(sc, 10);
    expect((await getBookingQuotaUsage(sc.tenantId)).used).toBe(10);
    await expect(assertPublicBookingQuota(sc.tenantId)).resolves.toBeUndefined();

    // 11件 = 110% 到達 → ここで初めて拒否
    await seedBookings(sc, 1);
    await expect(assertPublicBookingQuota(sc.tenantId)).rejects.toThrow();
    try {
      await assertPublicBookingQuota(sc.tenantId);
      throw new Error('should have thrown');
    } catch (e) {
      // 顧客向け文面に課金事情を出さない（商家の内情を客に見せない）
      expect(isAppError(e)).toBe(true);
      const msg = (e as AppError).userMessage;
      expect(msg).toContain('店舗へ直接');
      expect(msg).not.toContain('プラン');
      expect(msg).not.toContain('上限');
    }
  });

  it('課金免除テナントは無制限', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const plan = await prisma.plan.create({
      data: { code: `quota-ex-${sc.tenantId.slice(-8)}`, name: 'テスト免除', priceJpy: 0, maxBookingsPerMonth: 1 },
    });
    createdPlans.push(plan.id);
    await prisma.tenant.update({ where: { id: sc.tenantId }, data: { planId: plan.id, billingExempt: true } });
    await seedBookings(sc, 5);
    await expect(assertPublicBookingQuota(sc.tenantId)).resolves.toBeUndefined();
  });
});

/** 予約行を直接投入（クォータ計算は createdAt ベースなので予約エンジンを通す必要がない）。 */
async function seedBookings(
  sc: { tenantId: string; shopId: string; serviceId: string },
  n: number,
): Promise<void> {
  const customer = await prisma.customer.create({
    data: { tenantId: sc.tenantId, shopId: sc.shopId, name: 'quota', email: `q${Date.now()}@t.test` },
  });
  const base = new Date('2099-01-01T00:00:00Z').getTime();
  await prisma.booking.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId: customer.id,
      serviceId: sc.serviceId,
      startAt: new Date(base + i * 3600_000),
      endAt: new Date(base + i * 3600_000 + 1800_000),
      status: 'CONFIRMED' as const,
      totalPriceJpy: 1000,
      customerName: 'quota',
    })),
  });
}
