/**
 * トライアル終了予告・督促通知の統合テスト（実DB）。
 *
 * ここで守りたいのは「二重送信しないこと」と「送るべき時に送ること」の両方。
 * 日次スイープは取りこぼしの自己修復のため何度でも走る前提なので、
 * 重複防止がコードの慎重さではなく **DB 制約** で成立していることを確認する。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { sweepTrialNotices, enqueueBillingNotice, buildBillingNotification } from '@/server/services/billing-notification-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

/** トライアル中のテナント（オーナー付き）を用意。trialEndsAt を JST の N 日後に置く。 */
async function seedTrialTenant(daysLeft: number, opts: { exempt?: boolean; subStatus?: string | null } = {}) {
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  const role = await prisma.role.findFirstOrThrow({ where: { code: 'TENANT_OWNER', tenantId: null }, select: { id: true } });
  const owner = await prisma.user.create({
    data: {
      email: `owner-${sc.tenantId.slice(-8)}@example.com`,
      name: 'オーナー太郎',
      passwordHash: 'x',
      tenantId: sc.tenantId,
      status: 'ACTIVE',
    },
  });
  await prisma.membership.create({ data: { userId: owner.id, roleId: role.id } });
  // JST のその日の正午に置く（暦日で数えるので時刻の揺れに影響されない）
  const target = new Date(Date.now() + daysLeft * 86_400_000);
  await prisma.tenant.update({
    where: { id: sc.tenantId },
    data: {
      trialEndsAt: target,
      billingExempt: opts.exempt ?? false,
      stripeSubscriptionStatus: opts.subStatus ?? null,
    },
  });
  return { tenantId: sc.tenantId, ownerEmail: owner.email };
}

async function notices(tenantId: string) {
  return prisma.notificationJob.findMany({
    where: { tenantId, template: { in: ['TRIAL_ENDING_7', 'TRIAL_ENDING_3', 'TRIAL_ENDING_1', 'TRIAL_ENDED'] } },
    select: { template: true, recipient: true, dedupeKey: true, channel: true },
  });
}

describe('トライアル終了予告', () => {
  it.each([
    [7, 'TRIAL_ENDING_7'],
    [3, 'TRIAL_ENDING_3'],
    [1, 'TRIAL_ENDING_1'],
  ])('残り%d日で %s がオーナー宛に積まれる', async (days, template) => {
    const { tenantId, ownerEmail } = await seedTrialTenant(days);
    await sweepTrialNotices();
    const rows = await notices(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.template).toBe(template);
    expect(rows[0]!.recipient).toBe(ownerEmail);
    expect(rows[0]!.channel).toBe('EMAIL');
  });

  it('期限切れ後は TRIAL_ENDED', async () => {
    const { tenantId } = await seedTrialTenant(-1);
    await sweepTrialNotices();
    const rows = await notices(tenantId);
    expect(rows.map((r) => r.template)).toEqual(['TRIAL_ENDED']);
  });

  it('該当しない日（残り5日）には何も積まれない', async () => {
    const { tenantId } = await seedTrialTenant(5);
    await sweepTrialNotices();
    expect(await notices(tenantId)).toHaveLength(0);
  });

  it('スイープを何度回しても増えない（自己修復のため多重実行が前提）', async () => {
    const { tenantId } = await seedTrialTenant(3);
    await sweepTrialNotices();
    await sweepTrialNotices();
    await sweepTrialNotices();
    expect(await notices(tenantId)).toHaveLength(1);
  });

  it('同時に走っても増えない（多重起動＝DB制約で担保）', async () => {
    const { tenantId } = await seedTrialTenant(1);
    await Promise.all([sweepTrialNotices(), sweepTrialNotices(), sweepTrialNotices()]);
    expect(await notices(tenantId)).toHaveLength(1);
  });

  it('課金免除テナントには送らない（自社・デモに催促しない）', async () => {
    const { tenantId } = await seedTrialTenant(3, { exempt: true });
    await sweepTrialNotices();
    expect(await notices(tenantId)).toHaveLength(0);
  });

  it('既に契約済みなら送らない（申込直後に催促が飛ばない）', async () => {
    const { tenantId } = await seedTrialTenant(3, { subStatus: 'active' });
    await sweepTrialNotices();
    expect(await notices(tenantId)).toHaveLength(0);
  });

  it('トライアルを延長したら新しい期限で再度送れる', async () => {
    const { tenantId } = await seedTrialTenant(3);
    await sweepTrialNotices();
    expect(await notices(tenantId)).toHaveLength(1);

    // 期限を延ばす → dedupeKey が変わるので同じ種別でももう一度送れる
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { trialEndsAt: new Date(Date.now() + 3 * 86_400_000 + 7 * 86_400_000) },
    });
    await sweepTrialNotices(); // 残り10日 → 該当なし
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { trialEndsAt: new Date(Date.now() + 3 * 86_400_000 + 5 * 86_400_000) },
    });
    // 残り8日でもまだ該当しない。7日に合わせる
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { trialEndsAt: new Date(Date.now() + 7 * 86_400_000) },
    });
    await sweepTrialNotices();
    const rows = await notices(tenantId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((r) => r.dedupeKey)).size).toBe(rows.length); // 鍵は全て別
  });
});

describe('課金イベント通知の冪等', () => {
  it('同じ dedupeKey では2件目が作られない', async () => {
    const { tenantId } = await seedTrialTenant(30);
    const first = await enqueueBillingNotice({ tenantId, template: 'BILLING_PAYMENT_FAILED', dedupeKey: 'evt:evt_test_1' });
    const second = await enqueueBillingNotice({ tenantId, template: 'BILLING_PAYMENT_FAILED', dedupeKey: 'evt:evt_test_1' });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await prisma.notificationJob.count({ where: { tenantId, template: 'BILLING_PAYMENT_FAILED' } })).toBe(1);
  });

  it('別イベントなら別件として積まれる（Stripe の再試行ごとに督促する）', async () => {
    const { tenantId } = await seedTrialTenant(30);
    await enqueueBillingNotice({ tenantId, template: 'BILLING_PAYMENT_FAILED', dedupeKey: 'evt:a' });
    await enqueueBillingNotice({ tenantId, template: 'BILLING_PAYMENT_FAILED', dedupeKey: 'evt:b' });
    expect(await prisma.notificationJob.count({ where: { tenantId, template: 'BILLING_PAYMENT_FAILED' } })).toBe(2);
  });

  it('オーナーが居ないテナントには積まない（宛先不明のジョブを作らない）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const ok = await enqueueBillingNotice({ tenantId: sc.tenantId, template: 'TRIAL_ENDED', dedupeKey: 'trial:x' });
    expect(ok).toBe(false);
    expect(await prisma.notificationJob.count({ where: { tenantId: sc.tenantId } })).toBe(0);
  });
});

describe('文面', () => {
  it('全ての課金テンプレートに本文がある（空メール送信を防ぐ）', () => {
    for (const t of [
      'TRIAL_ENDING_7', 'TRIAL_ENDING_3', 'TRIAL_ENDING_1', 'TRIAL_ENDED',
      'BILLING_PAYMENT_FAILED', 'BILLING_PAYMENT_RECOVERED', 'BILLING_SUBSCRIPTION_CANCELED',
    ]) {
      const built = buildBillingNotification({ template: t, ownerName: '山田' });
      expect(built, t).not.toBeNull();
      expect(built!.subject.length).toBeGreaterThan(0);
      expect(built!.text.length).toBeGreaterThan(20);
      expect(built!.text).toContain('山田 様');
    }
  });

  it('予約系テンプレートは課金文面を返さない（取り違え防止）', () => {
    expect(buildBillingNotification({ template: 'BOOKING_CONFIRMED' })).toBeNull();
  });
});
