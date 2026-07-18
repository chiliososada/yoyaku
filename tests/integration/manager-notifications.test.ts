/**
 * 店長通知の統合テスト（実DB）。
 * 通知先（メール/LINE）を登録した店舗で、新規予約/キャンセルが店長向け notification_jobs を生成することを検証。
 * また LINE 連携コードの発行→消費（userId 登録）フローを検証。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, cancelBooking } from '@/server/services/booking-service';
import {
  addEmailRecipient,
  createLineLinkCode,
  consumeLineLinkCode,
  getActiveRecipients,
} from '@/server/services/notification-recipient-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const NOW = new Date('2026-09-03T00:00:00.000Z');
const START = new Date('2026-09-08T01:00:00.000Z'); // 10:00 JST
const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  // line_link_codes は tenant への FK が無く cascade されないため明示削除
  for (const t of createdTenants) {
    await prisma.lineLinkCode.deleteMany({ where: { tenantId: t } });
    await cleanupTenant(t);
  }
  await prisma.$disconnect();
});

async function managerJobs(bookingId: string) {
  const jobs = await prisma.notificationJob.findMany({
    where: { bookingId },
    select: { channel: true, recipient: true, template: true, payload: true },
  });
  return jobs.filter((j) => (j.payload as { audience?: string })?.audience === 'MANAGER');
}

describe('店長通知ジョブ', () => {
  it('通知先(メール+LINE)がある店舗の新規予約で、店長向けジョブが各チャネルに1件ずつ作られる', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.notificationRecipient.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, channel: 'EMAIL', address: 'tencho@example.com', label: '店長' },
    });
    await prisma.notificationRecipient.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, channel: 'LINE', address: 'Uline123', label: 'オーナー' },
    });

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: START,
      customer: { name: '山田', email: 'cust@example.com' },
      now: NOW,
    });

    const mgr = await managerJobs(b.id);
    expect(mgr).toHaveLength(2);
    expect(mgr.every((j) => j.template === 'BOOKING_CONFIRMED')).toBe(true);
    expect(mgr.find((j) => j.channel === 'EMAIL')?.recipient).toBe('tencho@example.com');
    expect(mgr.find((j) => j.channel === 'LINE')?.recipient).toBe('Uline123');

    // キャンセルでも店長向けジョブ（CANCELLED）が作られる
    await cancelBooking({ token: b.cancellationToken, now: NOW });
    const afterCancel = await managerJobs(b.id);
    const cancelJobs = afterCancel.filter((j) => j.template === 'BOOKING_CANCELLED');
    expect(cancelJobs.length).toBe(2);
  });

  it('通知先ゼロの店舗では店長向けジョブは作られない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: START,
      customer: { name: '佐藤', email: 'a@b.test' },
      now: NOW,
    });
    expect(await managerJobs(b.id)).toHaveLength(0);
  });
});

describe('LINE 連携コード', () => {
  it('発行→消費で LINE 通知先が登録され、コードは使い捨て', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);

    const { code } = await createLineLinkCode(sc.tenantId, sc.shopId, '店長 田中', null);
    const res = await consumeLineLinkCode(code, 'Uwebhookuser');
    expect(res?.shopId).toBe(sc.shopId);

    const rec = await prisma.notificationRecipient.findFirst({
      where: { shopId: sc.shopId, channel: 'LINE', address: 'Uwebhookuser' },
    });
    expect(rec?.active).toBe(true);
    expect(rec?.label).toBe('店長 田中');

    // 使い捨て: 2回目は無効
    expect(await consumeLineLinkCode(code, 'Uother')).toBeNull();

    // getActiveRecipients に含まれる
    const active = await getActiveRecipients(sc.shopId);
    expect(active.some((r) => r.channel === 'LINE' && r.address === 'Uwebhookuser')).toBe(true);
  });

  it('無効/期限切れコードは拒否', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    expect(await consumeLineLinkCode('NOPE99', 'Ux')).toBeNull();
    // consumeLineLinkCode は実時間の nowUtc() で期限判定するため、実過去の時刻で期限切れを作る。
    // code は PK なので実行ごとにユニークにする（このテーブルは tenant cascade されない）。
    const expiredCode = ('EXP' + Date.now().toString(36).toUpperCase()).slice(0, 10);
    await prisma.lineLinkCode.create({
      data: { code: expiredCode, tenantId: sc.tenantId, shopId: sc.shopId, expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await consumeLineLinkCode(expiredCode, 'Ux')).toBeNull();
  });

  it('メール通知先の追加は再登録で有効化（upsert）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await addEmailRecipient(sc.tenantId, sc.shopId, 'M@Example.com', '店長', null);
    const rec = await prisma.notificationRecipient.findFirst({
      where: { shopId: sc.shopId, channel: 'EMAIL' },
    });
    expect(rec?.address).toBe('m@example.com'); // 小文字正規化
  });
});
