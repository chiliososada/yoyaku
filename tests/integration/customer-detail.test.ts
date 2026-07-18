/**
 * 顧客カルテ統計（getCustomerDetail.stats）の統合テスト。
 * 表示リストの take:50 に依存せず、全予約から集計されることを保証する。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getCustomerDetail } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

type Scenario = Awaited<ReturnType<typeof seedScenario>>;

const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

async function booking(
  sc: Scenario,
  customerId: string,
  daysAgo: number,
  status: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED',
  price: number,
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

describe('getCustomerDetail.stats', () => {
  it('全予約から集計: 来店回数/累計/初回・最終来店/次回予約、キャンセル除外', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const c = await prisma.customer.create({ data: { tenantId: sc.tenantId, shopId: sc.shopId, name: 'カルテ客' } });

    await booking(sc, c.id, 100, 'COMPLETED', 3000); // 最古の来店
    await booking(sc, c.id, 30, 'COMPLETED', 5000);
    await booking(sc, c.id, 10, 'CONFIRMED', 4000); // 直近の来店
    await booking(sc, c.id, -7, 'CONFIRMED', 6000); // 未来 = 次回予約
    await booking(sc, c.id, 20, 'CANCELLED', 9999); // 除外

    const { stats } = await getCustomerDetail(sc.tenantId, c.id);
    expect(stats.visitCount).toBe(3); // 過去の CONFIRMED+COMPLETED
    expect(stats.totalSpent).toBe(12000); // 3000+5000+4000（キャンセル除外・未来除外）
    // 初回=100日前, 最終=10日前
    expect(Math.round((Date.now() - stats.firstVisit!.getTime()) / 86_400_000)).toBe(100);
    expect(Math.round((Date.now() - stats.lastVisit!.getTime()) / 86_400_000)).toBe(10);
    // 次回=7日後
    expect(stats.nextBooking).not.toBeNull();
    expect(stats.nextBooking!.getTime()).toBeGreaterThan(Date.now());
  });

  it('来店実績なしなら stats は 0/null', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const c = await prisma.customer.create({ data: { tenantId: sc.tenantId, shopId: sc.shopId, name: '新規' } });
    const { stats } = await getCustomerDetail(sc.tenantId, c.id);
    expect(stats.visitCount).toBe(0);
    expect(stats.totalSpent).toBe(0);
    expect(stats.firstVisit).toBeNull();
    expect(stats.lastVisit).toBeNull();
    expect(stats.nextBooking).toBeNull();
  });
});
