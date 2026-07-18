/**
 * Redis 接続（ioredis）。BullMQ・キャッシュ・分散処理で共有。
 * BullMQ は maxRetriesPerRequest=null を要求するため別途生成する。
 */
import IORedis, { type RedisOptions } from 'ioredis';
import { env } from './env';

const globalForRedis = globalThis as unknown as {
  redis: IORedis | undefined;
};

const baseOptions: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
};

export const redis = globalForRedis.redis ?? new IORedis(baseOptions);

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

/** BullMQ 専用接続オプション（Worker/Queue が要求する設定）。 */
export function createQueueConnection(): IORedis {
  return new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
