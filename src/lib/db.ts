/**
 * Prisma クライアントのシングルトン。
 * Next.js の開発時 HMR で複数インスタンスが生成されないようグローバルにキャッシュ。
 */
import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
        : [{ level: 'error', emit: 'stdout' }],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** トランザクションクライアントとプリズマクライアント双方を受け付ける型。 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export { Prisma };
