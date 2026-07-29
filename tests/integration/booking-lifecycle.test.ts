/**
 * 予約ライフサイクルの統合テスト（実DB）。
 * availability 問い合わせ → 予約作成 → 満席化 → 状態遷移 → キャンセルで枠解放、を検証。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  getDayAvailability,
  getDateAvailabilitySummary,
  createBooking,
  cancelBooking,
  getBookingByToken,
} from '@/server/services/booking-service';
import { updateBookingStatus } from '@/server/services/booking-admin-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const DATE = '2026-09-08';
const NOW = new Date('2026-09-03T00:00:00.000Z'); // 余裕（window/lead OK）
const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

async function firstAvailable(scenario: { tenantId: string; shopId: string; serviceId: string }) {
  const { slots } = await getDayAvailability({
    tenantId: scenario.tenantId,
    shopId: scenario.shopId,
    serviceId: scenario.serviceId,
    date: DATE,
    now: NOW,
  });
  const slot = slots.find((s) => s.available);
  expect(slot).toBeTruthy();
  return slot!;
}

describe('availability + 予約作成', () => {
  it('空きスロットを取得し、予約後はそのスロットが満席になる', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);

    const slot = await firstAvailable(sc);
    const booking = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceId: sc.serviceId,
      staffId: null,
      startAt: slot.startAt,
      customer: { name: 'テスト客', email: 'lifecycle@test.com' },
      now: NOW,
    });
    expect(booking.status).toBe('CONFIRMED');

    // 同じスロットを再取得 → 満席
    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date: DATE, now: NOW,
    });
    const same = slots.find((s) => s.startAt.getTime() === slot.startAt.getTime())!;
    expect(same.available).toBe(false);
    expect(same.reason).toBe('SLOT_FULL');
  });
});

describe('管理: 状態遷移', () => {
  it('CONFIRMED→COMPLETED は可、終端からの遷移は不可', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const slot = await firstAvailable(sc);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'A', email: 'a@test.com' }, now: NOW,
    });

    const done = await updateBookingStatus({ tenantId: sc.tenantId, bookingId: b.id, toStatus: 'COMPLETED' });
    expect(done.status).toBe('COMPLETED');

    // COMPLETED は終端 → CANCELLED 不可
    await expect(
      updateBookingStatus({ tenantId: sc.tenantId, bookingId: b.id, toStatus: 'CANCELLED' }),
    ).rejects.toMatchObject({ code: 'INVALID_BOOKING_STATE' });
  });

  it('管理キャンセルでスロットが解放される（active同期トリガ）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const slot = await firstAvailable(sc);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'B', email: 'b@test.com' }, now: NOW,
    });

    await updateBookingStatus({ tenantId: sc.tenantId, bookingId: b.id, toStatus: 'CANCELLED' });

    // active=false になっているか
    const items = await prisma.bookingItem.findMany({ where: { bookingId: b.id }, select: { active: true } });
    expect(items.every((i) => !i.active)).toBe(true);

    // 再取得で空きに戻る
    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date: DATE, now: NOW,
    });
    const same = slots.find((s) => s.startAt.getTime() === slot.startAt.getTime())!;
    expect(same.available).toBe(true);
  });
});

describe('公開: トークンキャンセル', () => {
  it('トークンで予約照会・キャンセルでき、枠が解放される', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const slot = await firstAvailable(sc);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'C', email: 'c@test.com' }, now: NOW,
    });

    const detail = await getBookingByToken(b.cancellationToken, NOW);
    expect(detail.cancellable).toBe(true);

    const res = await cancelBooking({ token: b.cancellationToken, now: NOW });
    expect(res.status).toBe('CANCELLED');

    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date: DATE, now: NOW,
    });
    const same = slots.find((s) => s.startAt.getTime() === slot.startAt.getTime())!;
    expect(same.available).toBe(true);
  });

  it('予約作成で24h前リマインドがスケジュールされ、キャンセルで無効化される', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const slot = await firstAvailable(sc);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'R', email: 'reminder@test.com' }, now: NOW,
    });
    const reminder = await prisma.notificationJob.findFirst({
      where: { bookingId: b.id, template: 'BOOKING_REMINDER' },
      select: { status: true, scheduledAt: true },
    });
    expect(reminder).toBeTruthy();
    expect(reminder!.status).toBe('PENDING');
    // 前日リマインド。同一時刻への集中を避けるため 0〜30 分のジッターを引いている。
    const lead = slot.startAt.getTime() - reminder!.scheduledAt.getTime();
    expect(lead).toBeGreaterThanOrEqual(24 * 3600 * 1000);
    expect(lead).toBeLessThanOrEqual(24 * 3600 * 1000 + 30 * 60 * 1000);

    await cancelBooking({ token: b.cancellationToken, now: NOW });
    const after = await prisma.notificationJob.findFirst({
      where: { bookingId: b.id, template: 'BOOKING_REMINDER' },
      select: { status: true },
    });
    expect(after!.status).toBe('CANCELLED');
  });

  it('キャンセル期限を過ぎた予約はキャンセル不可', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const slot = await firstAvailable(sc);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'D', email: 'd@test.com' }, now: NOW,
    });

    // 開始の1時間前を now にする（既定キャンセル期限24h → 超過）
    const lateNow = new Date(slot.startAt.getTime() - 60 * 60 * 1000);
    await expect(
      cancelBooking({ token: b.cancellationToken, now: lateNow }),
    ).rejects.toMatchObject({ code: 'CANCELLATION_DEADLINE_PASSED' });
  });
});

describe('日付サマリ（○△× 用）', () => {
  it('開店日は OPEN、スタッフ全欠勤は FULL、臨時休業は CLOSED', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);

    // 1) 初期は予約可能 → OPEN
    const summary1 = await getDateAvailabilitySummary({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, fromDate: DATE, days: 1, now: NOW,
    });
    expect(summary1[0]!.status).toBe('OPEN');

    // 2) 唯一のスタッフを当日欠勤に → 予約可能枠ゼロ → FULL
    await prisma.staffSchedule.create({
      data: {
        tenantId: sc.tenantId, shopId: sc.shopId, staffId: sc.staffIds[0]!,
        type: 'OVERRIDE', date: new Date(`${DATE}T00:00:00.000Z`), isWorking: false,
      },
    });
    const summary2 = await getDateAvailabilitySummary({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, fromDate: DATE, days: 1, now: NOW,
    });
    expect(summary2[0]!.status).toBe('FULL');

    // 3) 臨時休業 → CLOSED
    await prisma.specialBusinessDay.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, date: new Date(`${DATE}T00:00:00.000Z`), type: 'CLOSED' },
    });
    const summary3 = await getDateAvailabilitySummary({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, fromDate: DATE, days: 1, now: NOW,
    });
    expect(summary3[0]!.status).toBe('CLOSED');
  });

  it('範囲分の日数を返す', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    createdTenants.push(sc.tenantId);
    const summary = await getDateAvailabilitySummary({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, fromDate: DATE, days: 14, now: NOW,
    });
    expect(summary).toHaveLength(14);
    expect(summary.every((d) => ['OPEN', 'FEW', 'FULL', 'CLOSED'].includes(d.status))).toBe(true);
  });
});
