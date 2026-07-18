/**
 * 監査ログ（追記専用）。管理操作の入口で記録する。
 * before/after は任意。tenantId=null はプラットフォーム操作。
 */
import { prisma, type DbClient } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        tenantId: entry.tenantId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorType: 'USER',
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (e) {
    // 監査記録の失敗で業務処理を止めない（ログには残す）
    logger.error({ err: e, action: entry.action }, 'failed to write audit log');
  }
}
