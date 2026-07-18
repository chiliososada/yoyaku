/**
 * 売上・実績レポート（getMonthlyReport）の統合テスト。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getMonthlyReport } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

type Scenario = Awaited<ReturnType<typeof seedScenario>>;

const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

async function makeCustomer(sc: Scenario, name: string) {
  return prisma.customer.create({ data: { tenantId: sc.tenantId, shopId: sc.shopId, name } });
}

async function makeBooking(
  sc: Scenario,
  opts: { customerId: string; startAt: Date; price: number; nomination?: number; status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' },
) {
  const status = opts.status ?? 'CONFIRMED';
  const end = new Date(opts.startAt.getTime() + 60 * 60_000);
  const active = status !== 'CANCELLED';
  const b = await prisma.booking.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId: opts.customerId,
      serviceId: sc.serviceId,
      staffId: sc.staffIds[0]!,
      status,
      startAt: opts.startAt,
      endAt: end,
      totalPriceJpy: opts.price,
      nominationFeeJpy: opts.nomination ?? 0,
      customerName: 'Test',
    },
  });
  await prisma.bookingItem.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      bookingId: b.id,
      serviceId: sc.serviceId,
      staffId: sc.staffIds[0]!,
      startAt: opts.startAt,
      endAt: end,
      serviceEndAt: end,
      priceJpy: opts.price,
      active,
    },
  });
  return b;
}

describe('getMonthlyReport', () => {
  it('月次集計: 売上/指名率/新規リピート/メニュー別（キャンセル除外）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const A = await makeCustomer(sc, '顧客A');
    const B = await makeCustomer(sc, '顧客B');

    // A: 6月来店（前月）→ 7月はリピート扱い
    await makeBooking(sc, { customerId: A.id, startAt: new Date('2026-06-10T02:00:00Z'), price: 4000, status: 'COMPLETED' });
    // A: 7月 ¥5000
    await makeBooking(sc, { customerId: A.id, startAt: new Date('2026-07-10T02:00:00Z'), price: 5000, status: 'COMPLETED' });
    // B: 7月 ¥8000（指名料500 → 指名）新規
    await makeBooking(sc, { customerId: B.id, startAt: new Date('2026-07-15T02:00:00Z'), price: 8000, nomination: 500 });
    // 7月 キャンセル ¥3000 → 集計から除外
    await makeBooking(sc, { customerId: B.id, startAt: new Date('2026-07-20T02:00:00Z'), price: 3000, status: 'CANCELLED' });

    // now は月末以降を注入し、当月分がすべて「実現済み」として集計されるようにする
    const r = await getMonthlyReport(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2026-07', new Date('2026-08-01T00:00:00Z'));

    expect(r.totalRevenue).toBe(13000); // 5000+8000（キャンセル除外）
    expect(r.bookingCount).toBe(2);
    expect(r.avgSpend).toBe(6500);
    expect(r.nominationCount).toBe(1);
    expect(r.nominationRate).toBeCloseTo(0.5);
    expect(r.newCustomers).toBe(1); // B
    expect(r.repeatCustomers).toBe(1); // A（6月来店あり）
    expect(r.repeatRate).toBeCloseTo(0.5);

    // メニュー別（明細スナップショット、キャンセル除外）
    expect(r.byMenu).toHaveLength(1);
    expect(r.byMenu[0]!.count).toBe(2);
    expect(r.byMenu[0]!.revenue).toBe(13000);

    // スタッフ別
    expect(r.byStaff[0]!.count).toBe(2);
    expect(r.byStaff[0]!.revenue).toBe(13000);
    expect(r.byStaff[0]!.nomination).toBe(1);

    // 日別合計 = 総売上
    expect(r.daily.reduce((a, d) => a + d.revenue, 0)).toBe(13000);
  });

  it('実現主義: 同じ月でも「まだ時間が来ていない予約」は売上に含めない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const C = await makeCustomer(sc, '顧客C');
    // now = 2026-07-15 昼。10日（過去）は計上、20日（未来）は除外。
    const now = new Date('2026-07-15T03:00:00Z');
    await makeBooking(sc, { customerId: C.id, startAt: new Date('2026-07-10T02:00:00Z'), price: 5000, status: 'CONFIRMED' });
    await makeBooking(sc, { customerId: C.id, startAt: new Date('2026-07-20T02:00:00Z'), price: 8000, status: 'CONFIRMED' });

    const r = await getMonthlyReport(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2026-07', now);
    expect(r.totalRevenue).toBe(5000); // 10日のみ。20日（未来）は実現前なので除外
    expect(r.bookingCount).toBe(1);
    expect(r.byMenu[0]?.count ?? 0).toBe(1);
  });

  it('実現主義: 来店完了(COMPLETED)は開始時刻が未来でも計上、未実現の確定予約は除外', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const D = await makeCustomer(sc, '顧客D');
    const now = new Date('2026-07-15T03:00:00Z');
    // 開始は未来だが「来店完了」済み → 計上（明示的に来店済みのため）
    await makeBooking(sc, { customerId: D.id, startAt: new Date('2026-07-25T02:00:00Z'), price: 4000, status: 'COMPLETED' });
    // 未来の確定予約（未実現）→ 除外
    await makeBooking(sc, { customerId: D.id, startAt: new Date('2026-07-26T02:00:00Z'), price: 9000, status: 'CONFIRMED' });

    const r = await getMonthlyReport(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2026-07', now);
    expect(r.totalRevenue).toBe(4000); // COMPLETED のみ計上
    expect(r.bookingCount).toBe(1);
  });

  it('月ナビゲーション: 未来月は hasNext=false / prev・next 計算', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const r = await getMonthlyReport(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2099-01');
    expect(r.hasNext).toBe(false);
    expect(r.bookingCount).toBe(0);
    expect(r.prevMonth).toBe('2098-12');
    expect(r.nextMonth).toBe('2099-02');
    expect(r.daily).toHaveLength(31); // 1月は31日
  });
});
