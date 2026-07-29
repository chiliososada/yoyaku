/**
 * 通知ワーカー（BullMQ）。`npm run worker` で常駐起動。
 *  - BullMQ Queue に投入されたジョブ {notificationJobId} を処理（即時）
 *  - 併せて notification_jobs アウトボックスを定期スイープ（取りこぼし防止）
 *
 * 本番では Web プロセスと分離して常駐させる。
 */
import { Worker } from 'bullmq';
import { QUEUE_NAMES } from '@/lib/queue';
import { createQueueConnection } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { processNotificationJob, sweepPendingNotifications } from '@/server/services/notification-service';
import { sweepTrialNotices } from '@/server/services/billing-notification-service';
import type { NotificationJobData } from '@/lib/queue';

const worker = new Worker<NotificationJobData>(
  QUEUE_NAMES.NOTIFICATION,
  async (job) => {
    await processNotificationJob(job.data.notificationJobId);
  },
  { connection: createQueueConnection(), concurrency: env.QUEUE_CONCURRENCY },
);

worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'notification job completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'notification job failed'));

// アウトボックス定期スイープ（10秒間隔）
const SWEEP_INTERVAL_MS = 10_000;
const timer = setInterval(() => {
  sweepPendingNotifications()
    .then((n) => {
      if (n > 0) logger.info({ processed: n }, 'swept pending notifications');
    })
    .catch((err) => logger.error({ err }, 'notification sweep failed'));
}, SWEEP_INTERVAL_MS);

// トライアル終了予告の日次スイープ。
// 1時間ごとに回すのは冗長に見えるが、これは**取りこぼしの自己修復**が目的:
// worker が数時間落ちていても復帰後すぐ追いつく。二重送信は
// notification_jobs(tenantId, template, dedupeKey) の一意制約が防ぐため、
// 実行回数にも多重起動にも依存しない。
const TRIAL_SWEEP_INTERVAL_MS = 60 * 60_000;
const runTrialSweep = () =>
  sweepTrialNotices()
    .then((n) => {
      if (n > 0) logger.info({ queued: n }, 'queued trial notices');
    })
    .catch((err) => logger.error({ err }, 'trial notice sweep failed'));
const trialTimer = setInterval(runTrialSweep, TRIAL_SWEEP_INTERVAL_MS);
void runTrialSweep(); // 起動直後に一度

logger.info({ concurrency: env.QUEUE_CONCURRENCY }, '🔔 notification worker started');

async function shutdown() {
  logger.info('shutting down worker...');
  clearInterval(timer);
  clearInterval(trialTimer);
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
