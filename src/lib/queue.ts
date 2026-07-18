/**
 * BullMQ キュー定義。通知ジョブ等の非同期処理に使用。
 * Queue（投入）と Worker（処理）は分離。Worker は src/server/queue/worker.ts。
 */
import { Queue, type JobsOptions } from 'bullmq';
import { createQueueConnection } from './redis';

export const QUEUE_NAMES = {
  NOTIFICATION: 'notification',
} as const;

const globalForQueue = globalThis as unknown as {
  notificationQueue: Queue | undefined;
};

/** 通知キュー（メール/SMS/LINE 送信ジョブ）。 */
export const notificationQueue =
  globalForQueue.notificationQueue ??
  new Queue(QUEUE_NAMES.NOTIFICATION, {
    connection: createQueueConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForQueue.notificationQueue = notificationQueue;
}

export interface NotificationJobData {
  notificationJobId: string;
  tenantId: string;
}

/** 通知ジョブを投入。DB の NotificationJob（アウトボックス）と対で使う。 */
export async function enqueueNotification(
  data: NotificationJobData,
  opts?: JobsOptions,
): Promise<void> {
  await notificationQueue.add('send', data, opts);
}
