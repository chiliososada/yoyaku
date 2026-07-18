'use server';

/**
 * 課金（Stripe）関連の server actions。オーナー（SHOP_CREATE 保有者）のみ。
 */
import { requirePermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { Errors } from '@/lib/errors';
import { writeAudit } from '@/server/services/audit-service';
import { startCheckout, openPortal } from '@/server/billing/billing-service';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

/** プラン申込: Stripe Checkout の URL を返す（クライアントでリダイレクト）。 */
export async function startCheckoutAction(planId: string): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SHOP_CREATE);
    if (!user.tenantId) throw Errors.forbidden('テナントのオーナーのみ操作できます。');
    const url = await startCheckout(user.tenantId, planId, user.email);
    const meta = getRequestMeta();
    await writeAudit({
      tenantId: user.tenantId,
      actorUserId: user.id,
      action: 'billing.checkout.start',
      resourceType: 'plan',
      resourceId: planId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { url };
  });
}

/** Billing Portal（お支払い方法・請求書・解約）へ。 */
export async function openBillingPortalAction(): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SHOP_CREATE);
    if (!user.tenantId) throw Errors.forbidden('テナントのオーナーのみ操作できます。');
    const url = await openPortal(user.tenantId);
    return { url };
  });
}
