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

logger.info({ concurrency: env.QUEUE_CONCURRENCY }, '🔔 notification worker started');

async function shutdown() {
  logger.info('shutting down worker...');
  clearInterval(timer);
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
