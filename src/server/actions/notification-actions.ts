'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission, assertShopAccess, type SessionUser } from '@/server/auth/authorize';
import { PERMISSIONS, type Permission } from '@/lib/rbac';
import { Errors } from '@/lib/errors';
import { writeAudit } from '@/server/services/audit-service';
import * as svc from '@/server/services/notification-recipient-service';
import { lineAddFriendUrl } from '@/server/notifications/line';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

async function authz(permission: Permission, shopId: string): Promise<SessionUser & { tenantId: string }> {
  const user = await requirePermission(permission);
  if (!user.tenantId) throw Errors.forbidden('テナント管理者のみ操作できます。');
  assertShopAccess(user, shopId);
  return user as SessionUser & { tenantId: string };
}

async function audit(user: { id: string; tenantId: string }, action: string, resourceId: string | null) {
  const meta = getRequestMeta();
  await writeAudit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action,
    resourceType: 'notification_recipient',
    resourceId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

const emailSchema = z.object({
  email: z.string().trim().email('メール形式が不正です。'),
  label: z.string().trim().max(50).optional().or(z.literal('')),
});

/** メール通知先を追加。 */
export async function addEmailRecipientAction(shopId: string, input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const data = emailSchema.parse(input);
    const user = await authz(PERMISSIONS.SHOP_UPDATE, shopId);
    const r = await svc.addEmailRecipient(user.tenantId, shopId, data.email, data.label || null, user.id);
    await audit(user, 'notification.recipient.add.email', r.id);
    revalidatePath('/admin/notifications');
  });
}

/** 通知先を削除。 */
export async function removeRecipientAction(shopId: string, id: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.SHOP_UPDATE, shopId);
    await svc.removeRecipient(user.tenantId, shopId, id);
    await audit(user, 'notification.recipient.remove', id);
    revalidatePath('/admin/notifications');
  });
}

const linkSchema = z.object({ label: z.string().trim().max(50).optional().or(z.literal('')) });

/** LINE 連携コードを発行（QR とコードを返す。店長が友だち追加してコード送信で紐付く）。 */
export async function startLineLinkAction(
  shopId: string,
  input: unknown,
): Promise<ActionResult<{ code: string; addFriendUrl: string | null; expiresAt: string }>> {
  return runAction(async () => {
    const data = linkSchema.parse(input);
    const user = await authz(PERMISSIONS.SHOP_UPDATE, shopId);
    const { code, expiresAt } = await svc.createLineLinkCode(user.tenantId, shopId, data.label || null, user.id);
    await audit(user, 'notification.line.link.start', code);
    return { code, addFriendUrl: lineAddFriendUrl(), expiresAt: expiresAt.toISOString() };
  });
}
