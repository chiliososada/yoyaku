/**
 * 通知ジョブの処理（transactional outbox）。
 * createBooking 等が notification_jobs に PENDING 行を作る（同一トランザクション = 確実な記録）。
 * worker がこのサービスでアウトボックスを掃き出す。
 *  - EMAIL: SMTP 設定済みなら nodemailer で実送信、未設定ならログ（予約枠）。
 *  - SMS/LINE: 現状スタブ（将来 Twilio / LINE Messaging API を差し込む）。
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { nowUtc } from '@/lib/time';
import { isEmailConfigured, sendEmail } from '@/server/notifications/email';
import { isLineConfigured, sendLineMessage } from '@/server/notifications/line';
import { buildBookingEmail, buildManagerNotification, templateToManagerEvent } from '@/server/notifications/templates';

type JobRow = {
  id: string;
  channel: string;
  template: string;
  recipient: string;
  bookingId: string | null;
  payload: unknown;
};

/** ジョブ → 送信内容。宛先種別（payload.audience: MANAGER=店長 / それ以外=顧客）で文面を出し分け。 */
async function buildContent(job: JobRow): Promise<{ subject: string; text: string }> {
  if (!job.bookingId) return { subject: `[${job.template}]`, text: '' };
  const b = await prisma.booking.findUnique({
    where: { id: job.bookingId },
    select: {
      startAt: true,
      customerName: true,
      cancellationToken: true,
      service: { select: { name: true } },
      staff: { select: { name: true, displayName: true } },
      shop: { select: { name: true, timezone: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        select: { service: { select: { id: true, name: true } } },
      },
    },
  });
  if (!b) return { subject: `[${job.template}]`, text: '' };

  // コンボ予約はサービス名を「A + B」で連結
  const names: string[] = [];
  const seen = new Set<string>();
  for (const it of b.items) {
    if (seen.has(it.service.id)) continue;
    seen.add(it.service.id);
    names.push(it.service.name);
  }
  const serviceName = names.length > 0 ? names.join(' + ') : b.service.name;
  const staffName = b.staff?.displayName ?? b.staff?.name ?? null;

  const payload = (job.payload ?? {}) as { audience?: string; event?: string };
  if (payload.audience === 'MANAGER') {
    const event = (payload.event as 'CREATED' | 'RESCHEDULED' | 'CANCELLED') ?? templateToManagerEvent(job.template);
    return buildManagerNotification({
      event,
      shopName: b.shop.name,
      serviceName,
      staffName,
      startAt: b.startAt,
      timezone: b.shop.timezone,
      customerName: b.customerName,
      bookingId: job.bookingId,
    });
  }

  return buildBookingEmail({
    template: job.template as never,
    shopName: b.shop.name,
    serviceName,
    staffName,
    startAt: b.startAt,
    timezone: b.shop.timezone,
    customerName: b.customerName,
    cancellationToken: b.cancellationToken,
  });
}

/** チャネル別ディスパッチ。 */
async function dispatch(job: JobRow): Promise<void> {
  const content = await buildContent(job);

  if (job.channel === 'EMAIL') {
    if (isEmailConfigured()) {
      await sendEmail({ to: job.recipient, subject: content.subject, text: content.text });
      logger.info({ to: job.recipient, template: job.template }, '[notification] email sent');
    } else {
      logger.info({ to: job.recipient, subject: content.subject }, '[notification] email (stub, SMTP未設定)');
    }
    return;
  }

  if (job.channel === 'LINE') {
    if (isLineConfigured()) {
      await sendLineMessage(job.recipient, content.text);
      logger.info({ to: job.recipient, template: job.template }, '[notification] LINE sent');
    } else {
      logger.info({ to: job.recipient, template: job.template }, '[notification] LINE (stub, 未設定)');
    }
    return;
  }

  // SMS / その他: 将来実装
  logger.info({ channel: job.channel, recipient: job.recipient, template: job.template }, '[notification] dispatch (stub)');
}

/** 1件の通知ジョブを処理。成功で SENT、失敗で attempts++ / FAILED。 */
export async function processNotificationJob(jobId: string): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
  const job = await prisma.notificationJob.findUnique({ where: { id: jobId } });
  if (!job) return 'SKIPPED';
  if (job.status === 'SENT' || job.status === 'CANCELLED') return 'SKIPPED';

  // 原子的にクレーム（PENDING → PROCESSING）。スイープが重なっても勝者は1つ = 二重送信防止。
  const claimed = await prisma.notificationJob.updateMany({
    where: { id: job.id, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  });
  if (claimed.count === 0) return 'SKIPPED';

  try {
    // recipient 空（メール未登録など）は送信不能としてスキップ完了扱い
    if (!job.recipient) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: 'SENT', sentAt: nowUtc(), lastError: 'no recipient (skipped)' },
      });
      return 'SENT';
    }
    await dispatch(job as JobRow);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: { status: 'SENT', sentAt: nowUtc(), attempts: { increment: 1 } },
    });
    return 'SENT';
  } catch (e) {
    const attempts = job.attempts + 1;
    const failed = attempts >= job.maxAttempts;
    // 指数バックオフ（2/4/8/16分）。10秒スイープごとの即再試行で一時障害中に maxAttempts を使い切らないため。
    const backoffMs = Math.min(2 ** attempts, 30) * 60_000;
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: failed ? 'FAILED' : 'PENDING',
        attempts,
        ...(failed ? {} : { scheduledAt: new Date(Date.now() + backoffMs) }),
        lastError: e instanceof Error ? e.message : String(e),
      },
    });
    return failed ? 'FAILED' : 'SKIPPED';
  }
}

/** PENDING のアウトボックスを掃き出す。処理件数を返す。 */
export async function sweepPendingNotifications(limit = 50): Promise<number> {
  // worker クラッシュ等で PROCESSING のまま放置された行を回収（5分超は再送対象に戻す）。
  await prisma.notificationJob.updateMany({
    where: { status: 'PROCESSING', updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: 'PENDING' },
  });
  const jobs = await prisma.notificationJob.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: nowUtc() } },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let processed = 0;
  for (const j of jobs) {
    await processNotificationJob(j.id);
    processed += 1;
  }
  return processed;
}
