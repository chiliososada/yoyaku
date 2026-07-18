/**
 * LINE(LIFF) ネイティブ予約の統合テスト。
 * - createBooking に lineUserId を渡すと booking に userId が残り、
 *   顧客通知（確認/リマインド）が EMAIL ではなく LINE で作られること。
 * - lineUserId が無ければ従来どおりメールで作られること。
 * - バリデーションが「連絡先=lineUserId のみ」を許容すること。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/services/booking-service';
import { updateBookingStatus } from '@/server/services/booking-admin-service';
import { createBookingSchema } from '@/lib/validation/booking';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const NOW = new Date('2026-09-03T00:00:00.000Z');
const START = new Date('2026-09-08T00:00:00.000Z'); // 9:00 JST
const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

describe('予約バリデーション: LINE 連絡先', () => {
  it('lineUserId だけでも連絡先必須を満たす（メール/電話なしで可）', () => {
    const parsed = createBookingSchema.safeParse({
      serviceId: 'svc_1',
      startAt: '2026-09-08T00:00:00.000Z',
      customer: { name: 'LINE太郎' },
      lineUserId: 'Uabc0123456789',
    });
    expect(parsed.success).toBe(true);
  });

  it('メール・電話・LINE いずれも無ければ拒否', () => {
    const parsed = createBookingSchema.safeParse({
      serviceId: 'svc_1',
      startAt: '2026-09-08T00:00:00.000Z',
      customer: { name: '名無し' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('LINE 予約: 顧客通知の通道分岐', () => {
  it('lineUserId 付き: booking に userId が残り、確認+リマインドが LINE で作られる', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const LINE_UID = 'Uline_native_0001';

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: START,
      customer: { name: 'LINE太郎' }, // メールなし = LINE 身元のみ
      lineUserId: LINE_UID,
      now: NOW,
    });

    const row = await prisma.booking.findUnique({
      where: { id: b.id },
      select: { customerLineUserId: true, customerEmail: true },
    });
    expect(row?.customerLineUserId).toBe(LINE_UID);
    expect(row?.customerEmail).toBeNull();

    const jobs = await prisma.notificationJob.findMany({
      where: { bookingId: b.id },
      select: { channel: true, template: true, recipient: true, scheduledAt: true },
    });
    const confirmed = jobs.find((j) => j.template === 'BOOKING_CONFIRMED');
    const reminder = jobs.find((j) => j.template === 'BOOKING_REMINDER');
    expect(confirmed).toMatchObject({ channel: 'LINE', recipient: LINE_UID });
    expect(reminder).toMatchObject({ channel: 'LINE', recipient: LINE_UID });
    // リマインドは開始 24 時間前にスケジュール
    expect(reminder?.scheduledAt?.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    // メール宛の顧客ジョブ（@ を含む宛先）は作られない
    expect(jobs.some((j) => j.channel === 'EMAIL' && j.recipient.includes('@'))).toBe(false);
  });

  it('lineUserId なし: 従来どおりメールで確認+リマインドが作られる', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: START,
      customer: { name: 'メール花子', email: 'mail@test.com' },
      now: NOW,
    });

    const jobs = await prisma.notificationJob.findMany({
      where: { bookingId: b.id },
      select: { channel: true, template: true, recipient: true },
    });
    expect(jobs.find((j) => j.template === 'BOOKING_CONFIRMED')).toMatchObject({
      channel: 'EMAIL',
      recipient: 'mail@test.com',
    });
    expect(jobs.find((j) => j.template === 'BOOKING_REMINDER')).toMatchObject({
      channel: 'EMAIL',
      recipient: 'mail@test.com',
    });
    // LINE ジョブは作られない
    expect(jobs.some((j) => j.channel === 'LINE')).toBe(false);
  });

  it('店側キャンセル: LINE 予約の顧客へ LINE でキャンセル通知が作られる（リマインドは無効化）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const LINE_UID = 'Uline_admin_cancel_1';

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: START,
      customer: { name: 'LINE取消客' },
      lineUserId: LINE_UID,
      now: NOW,
    });

    await updateBookingStatus({ tenantId: sc.tenantId, bookingId: b.id, toStatus: 'CANCELLED', reason: '店都合' });

    const jobs = await prisma.notificationJob.findMany({
      where: { bookingId: b.id },
      select: { channel: true, template: true, recipient: true, status: true },
    });
    // キャンセル通知は LINE の userId 宛て
    expect(jobs.find((j) => j.template === 'BOOKING_CANCELLED')).toMatchObject({
      channel: 'LINE',
      recipient: LINE_UID,
      status: 'PENDING',
    });
    // リマインドは無効化される
    expect(jobs.find((j) => j.template === 'BOOKING_REMINDER')?.status).toBe('CANCELLED');
  });
});
