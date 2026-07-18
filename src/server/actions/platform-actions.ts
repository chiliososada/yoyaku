'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { writeAudit } from '@/server/services/audit-service';
import {
  createTenantSchema,
  setUserStatusSchema,
  planFormSchema,
  type PlanFormInput,
} from '@/lib/validation/platform';
import * as svc from '@/server/services/platform-mutation-service';
import { adminResetPassword } from '@/server/services/password-service';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

export async function createTenantAction(input: unknown): Promise<ActionResult<{ tenantId: string }>> {
  return runAction(async () => {
    const data = createTenantSchema.parse(input);
    const user = await requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE);
    const result = await svc.createTenant(data);
    const meta = getRequestMeta();
    await writeAudit({
      tenantId: result.tenantId,
      actorUserId: user.id,
      action: 'tenant.create',
      resourceType: 'tenant',
      resourceId: result.tenantId,
      after: { name: data.tenantName, slug: data.tenantSlug, ownerEmail: data.ownerEmail },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath('/platform/tenants');
    revalidatePath('/platform');
    return { tenantId: result.tenantId };
  });
}

export async function setUserStatusAction(userId: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<ActionResult> {
  return runAction(async () => {
    const { status: parsed } = setUserStatusSchema.parse({ status });
    const user = await requirePermission(PERMISSIONS.PLATFORM_USER_MANAGE);
    await svc.setUserStatus(userId, parsed);
    const meta = getRequestMeta();
    await writeAudit({
      actorUserId: user.id,
      action: `user.status.${parsed.toLowerCase()}`,
      resourceType: 'user',
      resourceId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath('/platform/users');
  });
}

/** 商家ユーザーのパスワードを強制リセットし、新しいパスワードを1度だけ返す（運用者が本人へ連絡）。 */
export async function resetUserPasswordAction(userId: string): Promise<ActionResult<{ email: string; newPassword: string }>> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.PLATFORM_USER_MANAGE);
    const result = await adminResetPassword(userId);
    const meta = getRequestMeta();
    await writeAudit({
      actorUserId: user.id,
      action: 'user.password.reset',
      resourceType: 'user',
      resourceId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return result;
  });
}

export async function updatePlanAction(planId: string, input: PlanFormInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = planFormSchema.parse(input);
    const user = await requirePermission(PERMISSIONS.PLATFORM_PLAN_MANAGE);
    await svc.updatePlan(planId, data);
    const meta = getRequestMeta();
    await writeAudit({
      actorUserId: user.id,
      action: 'plan.update',
      resourceType: 'plan',
      resourceId: planId,
      after: data,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath('/platform/plans');
  });
}

/** 課金免除の切替（既存店・特約店向け。免除中は課金ゲート対象外）。 */
export async function setBillingExemptAction(tenantId: string, exempt: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.PLATFORM_TENANT_MANAGE);
    await prisma.tenant.update({ where: { id: tenantId }, data: { billingExempt: exempt } });
    const meta = getRequestMeta();
    await writeAudit({
      actorUserId: user.id,
      action: exempt ? 'tenant.billing.exempt' : 'tenant.billing.unexempt',
      resourceType: 'tenant',
      resourceId: tenantId,
      after: { billingExempt: exempt },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    revalidatePath(`/platform/tenants/${tenantId}`);
  });
}
