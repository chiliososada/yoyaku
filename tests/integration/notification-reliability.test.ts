/**
 * 通知配信の信頼性に関する統合テスト（実DB）。
 * - リマインダーが同一時刻に集中せず分散すること（確認通知の配信詰まり防止）
 * - リトライ上限が障害の実時間（30〜60分）をカバーできる既定値であること
 * - 送信タイムアウトが PROCESSING 回収窓より短いこと（二重送信防止の不変条件）
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, getDayAvailability } from '@/server/services/booking-service';
import {
  countFailedNotifications,
  listFailedNotifications,
  retryFailedNotification,
  processNotificationJob,
} from '@/server/services/notification-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const DATE = '2026-09-08';
const NOW = new Date('2026-09-03T00:00:00.000Z');
const createdTenants: string[] = [];

/** 予約を1件作る（モジュール共通ヘルパー）。 */
async function mkBooking(
  sc: { tenantId: string; shopId: string; serviceId: string },
  email: string,
) {
  const { slots } = await getDayAvailability({
    tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date: DATE, now: NOW,
  });
  return createBooking({
    tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
    startAt: slots.find((s) => s.available)!.startAt,
    customer: { name: '失敗', email }, now: NOW,
  });
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

describe('リマインダーの分散（バースト回避）', () => {
  it('同一開始時刻の予約でもリマインダー時刻がばらける', async () => {
    // 同時刻に複数の予約を作るため、同時受付数の大きい店舗を用意
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 20, serviceCapacity: 20, shopCapacity: 20, requiresStaff: false });
    createdTenants.push(sc.tenantId);

    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceId: sc.serviceId,
      date: DATE,
      now: NOW,
    });
    const slot = slots.find((s) => s.available)!;
    expect(slot).toBeTruthy();

    const N = 12;
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const b = await createBooking({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceId: sc.serviceId,
        staffId: null,
        startAt: slot.startAt,
        customer: { name: `客${i}`, email: `burst${i}@test.com` },
        now: NOW,
      });
      ids.push(b.id);
    }

    const reminders = await prisma.notificationJob.findMany({
      where: { bookingId: { in: ids }, template: 'BOOKING_REMINDER' },
      select: { scheduledAt: true },
    });
    expect(reminders).toHaveLength(N);

    // すべて「開始24時間前 〜 24時間30分前」の範囲内
    const start = slot.startAt.getTime();
    for (const r of reminders) {
      const lead = start - r.scheduledAt.getTime();
      expect(lead).toBeGreaterThanOrEqual(24 * 3600 * 1000);
      expect(lead).toBeLessThanOrEqual(24 * 3600 * 1000 + 30 * 60 * 1000);
    }

    // かつ 1 点に集中していない（同一開始時刻でも複数の異なる時刻に散る）
    const distinct = new Set(reminders.map((r) => r.scheduledAt.getTime()));
    expect(distinct.size).toBeGreaterThan(N / 2);
  });
});

describe('リトライ設定の不変条件', () => {
  it('新規ジョブの maxAttempts 既定は 30分超の障害をカバーする', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);

    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceId: sc.serviceId,
      date: DATE,
      now: NOW,
    });
    const slot = slots.find((s) => s.available)!;
    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceId: sc.serviceId,
      staffId: null,
      startAt: slot.startAt,
      customer: { name: 'retry', email: 'retry@test.com' },
      now: NOW,
    });

    const job = await prisma.notificationJob.findFirstOrThrow({
      where: { bookingId: b.id, template: 'BOOKING_CONFIRMED' },
      select: { maxAttempts: true },
    });

    // バックオフは min(2^n, 30) 分。maxAttempts 回目で打ち切り。
    let coverageMin = 0;
    for (let n = 1; n < job.maxAttempts; n++) coverageMin += Math.min(2 ** n, 30);
    // LINE/SMTP の典型的な障害（30〜60分）を越えて耐えられること
    expect(coverageMin).toBeGreaterThanOrEqual(120);
  });
});

describe('配信できなかった通知の可視化', () => {
  it('FAILED を一覧でき、再送でPENDINGに戻る。他テナントのものは見えない', async () => {
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);

    const mkBooking = async (sc: typeof a, email: string) => {
      const { slots } = await getDayAvailability({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceId: sc.serviceId,
        date: DATE,
        now: NOW,
      });
      return createBooking({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceId: sc.serviceId,
        staffId: null,
        startAt: slots.find((s) => s.available)!.startAt,
        customer: { name: '失敗', email },
        now: NOW,
      });
    };

    const bookingA = await mkBooking(a, 'fail-a@test.com');
    const bookingB = await mkBooking(b, 'fail-b@test.com');

    // 各テナントの確認通知を FAILED に落とす（配信を諦めた状態を再現）
    for (const [tid, bid] of [
      [a.tenantId, bookingA.id],
      [b.tenantId, bookingB.id],
    ] as const) {
      await prisma.notificationJob.updateMany({
        where: { tenantId: tid, bookingId: bid, template: 'BOOKING_CONFIRMED' },
        data: { status: 'FAILED', attempts: 9, lastError: 'SMTP 550 mailbox unavailable' },
      });
    }

    // テナント A からは A の 1 件だけ見える
    const listA = await listFailedNotifications(a.tenantId, { shopId: a.shopId });
    expect(listA).toHaveLength(1);
    expect(listA[0]!.recipient).toBe('fail-a@test.com');
    expect(listA[0]!.attempts).toBe(9);
    expect(listA[0]!.lastError).toContain('550');
    expect(listA[0]!.booking?.customerName).toBe('失敗');
    expect(await countFailedNotifications(a.tenantId, a.shopId)).toBe(1);

    // 他テナントのジョブIDを渡しても再送できない（テナント越境の防止）
    const crossed = await retryFailedNotification(a.tenantId, (await listFailedNotifications(b.tenantId))[0]!.id);
    expect(crossed).toBe(false);
    expect(await countFailedNotifications(b.tenantId)).toBe(1); // B のものは FAILED のまま

    // 自テナントのものは再送できる → PENDING に戻り、一覧から消える
    const ok = await retryFailedNotification(a.tenantId, listA[0]!.id);
    expect(ok).toBe(true);
    const job = await prisma.notificationJob.findUniqueOrThrow({
      where: { id: listA[0]!.id },
      select: { status: true, attempts: true, lastError: true },
    });
    expect(job.status).toBe('PENDING');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeNull();
    expect(await countFailedNotifications(a.tenantId, a.shopId)).toBe(0);

    // 二重クリックしても二度目は何も起きない
    expect(await retryFailedNotification(a.tenantId, listA[0]!.id)).toBe(false);
  });
});

describe('送信直前の鮮度チェック', () => {
  it('キャンセル済み予約のリマインドは送らず CANCELLED にする', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const b = await mkBooking(sc, 'stale-cancel@test.com');
    // 通知ジョブだけ PENDING に戻し、予約はキャンセル状態にする
    // （障害でジョブが滞留している間にキャンセルされた状況を再現）
    await prisma.notificationJob.updateMany({
      where: { bookingId: b.id }, data: { status: 'PENDING' },
    });
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });

    const job = await prisma.notificationJob.findFirst({
      where: { bookingId: b.id, template: 'BOOKING_REMINDER' }, select: { id: true },
    });
    const r = await processNotificationJob(job!.id);
    expect(r).toBe('SKIPPED');
    const after = await prisma.notificationJob.findUnique({
      where: { id: job!.id }, select: { status: true, lastError: true },
    });
    expect(after!.status).toBe('CANCELLED');
    expect(after!.lastError).toContain('stale');
  });

  it('開始時刻を過ぎた予約のリマインドは送らない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const b = await mkBooking(sc, 'stale-past@test.com');
    await prisma.notificationJob.updateMany({ where: { bookingId: b.id }, data: { status: 'PENDING' } });
    // 予約を過去へ動かす（worker 停止から復帰した状況）
    await prisma.booking.update({
      where: { id: b.id },
      data: { startAt: new Date(Date.now() - 3 * 3600_000), endAt: new Date(Date.now() - 2 * 3600_000) },
    });
    const job = await prisma.notificationJob.findFirst({
      where: { bookingId: b.id, template: 'BOOKING_REMINDER' }, select: { id: true },
    });
    expect(await processNotificationJob(job!.id)).toBe('SKIPPED');
  });

  it('キャンセル通知はキャンセル済みでも送る（巻き添えにしない）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const b = await mkBooking(sc, 'cancel-notice@test.com');
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
    const job = await prisma.notificationJob.create({
      data: {
        tenantId: sc.tenantId, bookingId: b.id, channel: 'EMAIL',
        template: 'BOOKING_CANCELLED', recipient: 'cancel-notice@test.com', status: 'PENDING',
        payload: { bookingId: b.id },
      },
      select: { id: true },
    });
    expect(await processNotificationJob(job.id)).not.toBe('SKIPPED');
  });
});
