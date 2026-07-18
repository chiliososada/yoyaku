/**
 * 休眠顧客抽出（getDormantCustomers）の統合テスト。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getDormantCustomers } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

type Scenario = Awaited<ReturnType<typeof seedScenario>>;

const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

async function makeCustomer(sc: Scenario, name: string) {
  return prisma.customer.create({ data: { tenantId: sc.tenantId, shopId: sc.shopId, name } });
}

async function booking(
  sc: Scenario,
  customerId: string,
  daysAgo: number, // 負値=未来
  status: 'CONFIRMED' | 'COMPLETED' = 'COMPLETED',
  price = 5000,
) {
  const start = new Date(Date.now() - daysAgo * 86_400_000);
  return prisma.booking.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId,
      serviceId: sc.serviceId,
      staffId: sc.staffIds[0]!,
      status,
      startAt: start,
      endAt: new Date(start.getTime() + 3_600_000),
      totalPriceJpy: price,
      customerName: 'x',
    },
  });
}

describe('getDormantCustomers', () => {
  it('N日以上未来店 かつ 今後の予約なし の顧客を抽出', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);

    const A = await makeCustomer(sc, 'A休眠'); // 最終100日前・2回来店
    await booking(sc, A.id, 100);
    await booking(sc, A.id, 200);
    const B = await makeCustomer(sc, 'B最近'); // 30日前 → 休眠でない
    await booking(sc, B.id, 30);
    const C = await makeCustomer(sc, 'C予約あり'); // 100日前だが今後の予約あり → 除外
    await booking(sc, C.id, 100);
    await booking(sc, C.id, -5, 'CONFIRMED');

    const list = await getDormantCustomers(sc.tenantId, sc.shopId, 90);
    const ids = list.map((c) => c.id);
    expect(ids).toContain(A.id);
    expect(ids).not.toContain(B.id);
    expect(ids).not.toContain(C.id);

    const a = list.find((c) => c.id === A.id)!;
    expect(a.visitCount).toBe(2);
    expect(a.totalSpent).toBe(10000);
    expect(a.lastVisit.getTime()).toBeLessThan(Date.now() - 90 * 86_400_000);
  });

  it('閾値を変えると判定が変わる（30日前は days=90 で非休眠 / days=14 で休眠）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const X = await makeCustomer(sc, 'X');
    await booking(sc, X.id, 30);

    expect((await getDormantCustomers(sc.tenantId, sc.shopId, 90)).some((c) => c.id === X.id)).toBe(false);
    expect((await getDormantCustomers(sc.tenantId, sc.shopId, 14)).some((c) => c.id === X.id)).toBe(true);
  });
});
