/**
 * 日次スケジュール（getDaySchedule）の統合テスト。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getDaySchedule } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

type Scenario = Awaited<ReturnType<typeof seedScenario>>;

const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

async function makeBooking(
  sc: Scenario,
  opts: { staffId: string | null; startAt: Date; durationMin?: number; status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'; name?: string },
) {
  const end = new Date(opts.startAt.getTime() + (opts.durationMin ?? 60) * 60_000);
  const c = await prisma.customer.create({ data: { tenantId: sc.tenantId, shopId: sc.shopId, name: opts.name ?? '客' } });
  return prisma.booking.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId: c.id,
      serviceId: sc.serviceId,
      staffId: opts.staffId,
      status: opts.status ?? 'CONFIRMED',
      startAt: opts.startAt,
      endAt: end,
      totalPriceJpy: 5000,
      customerName: opts.name ?? '客',
    },
  });
}

describe('getDaySchedule', () => {
  it('スタッフ別レーンに予約を時間で配置し、キャンセルは除外', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    created.push(sc.tenantId);
    const [s0, s1] = sc.staffIds;

    // JST 10:00 = 01:00 UTC → startMin 600
    await makeBooking(sc, { staffId: s0!, startAt: new Date('2026-07-06T01:00:00Z'), name: '田中様' });
    // JST 11:30 = 02:30 UTC → startMin 690, 45分
    await makeBooking(sc, { staffId: s1!, startAt: new Date('2026-07-06T02:30:00Z'), durationMin: 45, name: '鈴木様' });
    // キャンセルは表示しない
    await makeBooking(sc, { staffId: s0!, startAt: new Date('2026-07-06T05:00:00Z'), status: 'CANCELLED', name: '除外様' });

    const sched = await getDaySchedule(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2026-07-06');

    const lane0 = sched.lanes.find((l) => l.key === s0);
    const lane1 = sched.lanes.find((l) => l.key === s1);
    expect(lane0?.bookings).toHaveLength(1); // キャンセル除外で1件
    expect(lane0?.bookings[0]!.startMin).toBe(600);
    expect(lane0?.bookings[0]!.endMin).toBe(660);
    expect(lane0?.bookings[0]!.customerName).toBe('田中様');

    expect(lane1?.bookings).toHaveLength(1);
    expect(lane1?.bookings[0]!.startMin).toBe(690);
    expect(lane1?.bookings[0]!.endMin).toBe(735); // +45分

    // タイムライン範囲は予約を内包
    expect(sched.openMin).toBeLessThanOrEqual(600);
    expect(sched.closeMin).toBeGreaterThanOrEqual(735);
    expect(sched.isClosed).toBe(false);
    expect(sched.prevDate).toBe('2026-07-05');
    expect(sched.nextDate).toBe('2026-07-07');
  });

  it('未割当（担当なし）は専用レーンに入る', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    await makeBooking(sc, { staffId: null, startAt: new Date('2026-07-06T01:00:00Z'), name: 'おまかせ様' });
    const sched = await getDaySchedule(sc.tenantId, sc.shopId, 'Asia/Tokyo', '2026-07-06');
    const unassigned = sched.lanes.find((l) => l.key === '__none__');
    expect(unassigned).toBeTruthy();
    expect(unassigned?.bookings[0]!.customerName).toBe('おまかせ様');
  });
});
