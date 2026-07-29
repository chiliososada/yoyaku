/**
 * 課金系の通知（トライアル終了予告・督促・解約確認）。
 *
 * 設計方針:
 *  - 送信そのものは既存のアウトボックス（notification_jobs → worker → dispatch）に完全に乗せる。
 *    リトライ・バックオフ・失敗の可視化・タイムアウトは既に作ってあるものを再利用する。
 *  - **重複送信は DB の一意制約で止める**（tenantId, template, dedupeKey）。
 *    日次スイープは「取りこぼしの自己修復」のため何度でも走ってよい設計にし、
 *    コード側の慎重さや実行回数に依存しない。多重起動でも成立する。
 *  - 日付境界は **店舗のタイムゾーン（JST）** で数える。UTC で数えると
 *    「あと1日」の通知が日本時間の夜中にずれる。
 */
import { prisma } from '@/lib/db';
import { Prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { nowUtc, zonedDateString, formatInTz } from '@/lib/time';
import type { NotificationTemplate } from '@prisma/client';

/** 契約済みとみなす Stripe status（この状態のテナントにトライアル通知は送らない）。 */
const SUBSCRIBED_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** JST 暦日での日数差（end - now）。時刻ではなく暦日で数える。 */
function daysUntilInJst(target: Date, now: Date): number {
  const a = Date.parse(`${zonedDateString(target, 'Asia/Tokyo')}T00:00:00Z`);
  const b = Date.parse(`${zonedDateString(now, 'Asia/Tokyo')}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** 商家オーナーのメール宛先を解決。オーナーが居なければ null（送らない）。 */
async function resolveOwnerRecipient(tenantId: string): Promise<{ email: string; name: string } | null> {
  const owner = await prisma.user.findFirst({
    where: {
      tenantId,
      status: 'ACTIVE',
      deletedAt: null,
      memberships: { some: { role: { code: 'TENANT_OWNER' } } },
    },
    select: { email: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  return owner ? { email: owner.email, name: owner.name } : null;
}

/**
 * 課金通知を1件キューへ入れる。既に同じ用件が入っていれば **何もしない**（DB 制約で判定）。
 * 戻り値: 新規に登録したか。
 */
export async function enqueueBillingNotice(input: {
  tenantId: string;
  template: NotificationTemplate;
  dedupeKey: string;
  payload?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const owner = await resolveOwnerRecipient(input.tenantId);
  if (!owner) {
    logger.warn({ tenantId: input.tenantId, template: input.template }, '[billing-notify] owner not found — skipped');
    return false;
  }
  try {
    await prisma.notificationJob.create({
      data: {
        tenantId: input.tenantId,
        channel: 'EMAIL',
        template: input.template,
        recipient: owner.email,
        dedupeKey: input.dedupeKey,
        payload: { audience: 'OWNER', ownerName: owner.name, ...(input.payload as object ?? {}) },
      },
    });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // 同じ用件は登録済み。日次スイープが何度走ってもここで止まる。
      return false;
    }
    throw e;
  }
}

/**
 * トライアル終了に関する通知を必要な分だけ積む。**冪等**なので何度でも呼んでよい。
 * 対象外: 課金免除、既に契約済み、トライアル未設定。
 */
export async function sweepTrialNotices(now: Date = nowUtc()): Promise<number> {
  // T-7 〜 T-0 の範囲に入りうるテナントだけ引く（全件走査しない）
  const from = new Date(now.getTime() - 2 * 86_400_000);
  const to = new Date(now.getTime() + 9 * 86_400_000);
  const tenants = await prisma.tenant.findMany({
    where: {
      billingExempt: false,
      deletedAt: null,
      trialEndsAt: { not: null, gte: from, lte: to },
    },
    select: { id: true, trialEndsAt: true, stripeSubscriptionStatus: true },
  });

  let queued = 0;
  for (const t of tenants) {
    if (!t.trialEndsAt) continue;
    // 既に契約済みならトライアル通知は不要（申込直後に催促が飛ぶのを防ぐ）
    if (t.stripeSubscriptionStatus && SUBSCRIBED_STATUSES.has(t.stripeSubscriptionStatus)) continue;

    const d = daysUntilInJst(t.trialEndsAt, now);
    const template: NotificationTemplate | null =
      d === 7 ? 'TRIAL_ENDING_7' : d === 3 ? 'TRIAL_ENDING_3' : d === 1 ? 'TRIAL_ENDING_1' : d <= 0 ? 'TRIAL_ENDED' : null;
    if (!template) continue;

    // 鍵に終了日を含める: トライアルを延長したら別の用件として再度送れる
    const key = `trial:${zonedDateString(t.trialEndsAt, 'Asia/Tokyo')}`;
    if (await enqueueBillingNotice({ tenantId: t.id, template, dedupeKey: key, payload: { trialEndsAt: t.trialEndsAt.toISOString() } })) {
      queued += 1;
    }
  }
  if (queued > 0) logger.info({ queued }, '[billing-notify] trial notices queued');
  return queued;
}

/** 課金通知の本文。宛先は商家オーナー（来店客ではない）。 */
export function buildBillingNotification(input: {
  /// 既存アウトボックスの JobRow.template は string のためここも string で受ける
  template: string;
  ownerName?: string;
  trialEndsAt?: string;
}): { subject: string; text: string } | null {
  const billingUrl = `${env.APP_BASE_URL}/admin/billing`;
  const name = input.ownerName ? `${input.ownerName} 様` : 'ご担当者様';
  const endLabel = input.trialEndsAt ? formatInTz(new Date(input.trialEndsAt), 'yyyy年M月d日', 'Asia/Tokyo') : null;
  const sign = ['', '― Yoyaku / マイアークス株式会社'].join('\n');

  switch (input.template) {
    case 'TRIAL_ENDING_7':
    case 'TRIAL_ENDING_3':
    case 'TRIAL_ENDING_1': {
      const days = input.template === 'TRIAL_ENDING_7' ? 7 : input.template === 'TRIAL_ENDING_3' ? 3 : 1;
      return {
        subject: `【Yoyaku】無料トライアルは残り${days}日です`,
        text: [
          name, '',
          `いつも Yoyaku をご利用いただきありがとうございます。`,
          `無料トライアルの期限${endLabel ? `（${endLabel}）` : ''}まで残り ${days} 日となりました。`,
          '',
          '期限までにお手続きいただくと、設定やデータはそのまま引き継がれます。',
          `お手続き: ${billingUrl}`,
          '',
          '※ 期限を過ぎても、お客様向けの予約ページは引き続き稼働します（管理画面のご利用が制限されます）。',
          sign,
        ].join('\n'),
      };
    }
    case 'TRIAL_ENDED':
      return {
        subject: '【Yoyaku】無料トライアルが終了しました',
        text: [
          name, '',
          '無料トライアルの期間が終了しました。',
          '管理画面を引き続きご利用いただくには、プランのお申し込みが必要です。',
          '',
          `お申し込み: ${billingUrl}`,
          '',
          'これまでの設定・予約データはそのまま保持しています。お申し込み後すぐに元の状態でお使いいただけます。',
          'ご不明な点がありましたら、このメールにご返信ください。',
          sign,
        ].join('\n'),
      };
    case 'BILLING_PAYMENT_FAILED':
      return {
        subject: '【Yoyaku】お支払いを確認できませんでした',
        text: [
          name, '',
          '月額利用料のお支払いを確認できませんでした。',
          'カードの有効期限切れや限度額超過が主な原因です。お手数ですが、お支払い方法をご確認ください。',
          '',
          `お支払い方法の更新: ${billingUrl}`,
          '',
          '※ しばらくの間はこれまでどおりご利用いただけます。お早めのご対応をお願いいたします。',
          sign,
        ].join('\n'),
      };
    case 'BILLING_PAYMENT_RECOVERED':
      return {
        subject: '【Yoyaku】お支払いを確認しました',
        text: [
          name, '',
          'お支払いを確認いたしました。ありがとうございます。',
          '引き続き通常どおりご利用いただけます。',
          sign,
        ].join('\n'),
      };
    case 'BILLING_SUBSCRIPTION_CANCELED':
      return {
        subject: '【Yoyaku】解約手続きが完了しました',
        text: [
          name, '',
          '解約のお手続きが完了しました。ご利用ありがとうございました。',
          'お支払い済み期間の末日までは、これまでどおりすべての機能をお使いいただけます。',
          '',
          `再開をご希望の場合: ${billingUrl}`,
          '',
          'ご意見・ご要望がありましたら、このメールにご返信いただけますと幸いです。',
          sign,
        ].join('\n'),
      };
    default:
      return null;
  }
}
