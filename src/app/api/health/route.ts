/**
 * ヘルスチェック（運用/デプロイのレディネスプローブ用）。
 * DB と Redis の疎通を確認。すべて正常なら 200、いずれか異常なら 503。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function checkDb(): Promise<boolean> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 2000);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const pong = await withTimeout(redis.ping(), 2000);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function GET() {
  const [db, redisOk] = await Promise.all([checkDb(), checkRedis()]);
  const ok = db && redisOk;
  return NextResponse.json(
    {
      status: ok ? 'ok' : 'degraded',
      checks: { database: db ? 'up' : 'down', redis: redisOk ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
