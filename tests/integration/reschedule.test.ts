/**
 * 予約改期（rescheduleBooking）の統合テスト: 占有の付け替え・旧枠解放・満席拒否・変更期限。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, rescheduleBooking } from '@/server/services/booking-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const NOW = new Date('2026-07-05T00:00:00Z');
const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

describe('rescheduleBooking', () => {
  it('新時間へ移動し、旧枠を解放する', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;

    // 7/6 10:00 JST(=01:00 UTC) に予約
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });

    // 11:00 JST(=02:00 UTC) へ改期
    const r = await rescheduleBooking({
      bookingId: b.id, newStartAt: new Date('2026-07-06T02:00:00Z'), newStaffId: s0, actorType: 'USER', now: NOW,
    });
    expect(r.startAt.toISOString()).toBe('2026-07-06T02:00:00.000Z');

    // アクティブ明細は新時間に移動している
    const items = await prisma.bookingItem.findMany({ where: { bookingId: b.id, active: true }, select: { startAt: true } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.startAt.getTime() >= new Date('2026-07-06T02:00:00Z').getTime())).toBe(true);

    // RESCHEDULED イベントが記録される
    const ev = await prisma.bookingEvent.count({ where: { bookingId: b.id, type: 'RESCHEDULED' } });
    expect(ev).toBe(1);

    // 旧枠(10:00)は解放され、別予約が取れる
    const b2 = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'B', email: 'b@x.com' }, now: NOW,
    });
    expect(b2.status).toBe('CONFIRMED');
  });

  it('埋まっている枠へは改期できない（SLOT_FULL）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;

    await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });
    const bB = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T03:00:00Z'), customer: { name: 'B', email: 'b@x.com' }, now: NOW,
    });

    // bB を A の枠(10:00, 同一スタッフ)へ改期 → 満席
    await expect(
      rescheduleBooking({ bookingId: bB.id, newStartAt: new Date('2026-07-06T01:00:00Z'), newStaffId: s0, actorType: 'USER', now: NOW }),
    ).rejects.toMatchObject({ code: 'SLOT_FULL' });

    // 失敗時ロールバック: bB は元の時間のまま
    const after = await prisma.booking.findUnique({ where: { id: bB.id }, select: { startAt: true } });
    expect(after!.startAt.toISOString()).toBe('2026-07-06T03:00:00.000Z');
  });

  it('顧客の変更期限超過は拒否（enforceDeadline）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });
    // 開始30分前に変更しようとする（既定の期限24hを過ぎている）
    await expect(
      rescheduleBooking({
        bookingId: b.id, newStartAt: new Date('2026-07-06T05:00:00Z'), actorType: 'CUSTOMER',
        enforceDeadline: true, now: new Date('2026-07-06T00:30:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'CANCELLATION_DEADLINE_PASSED' });
  });
});
