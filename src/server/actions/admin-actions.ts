'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission, assertShopAccess, type SessionUser } from '@/server/auth/authorize';
import { PERMISSIONS, type Permission } from '@/lib/rbac';
import { Errors } from '@/lib/errors';
import { writeAudit } from '@/server/services/audit-service';
import {
  staffFormSchema,
  serviceFormSchema,
  shopSettingsSchema,
  specialDaySchema,
  businessHoursSchema,
  capacityRuleSchema,
  staffScheduleSchema,
  staffOverrideSchema,
  shopCreateSchema,
  staffLoginSchema,
  type StaffFormInput,
  type ServiceFormInput,
  type ShopSettingsInput,
  type SpecialDayInput,
  type BusinessHoursInput,
  type CapacityRuleInput,
  type StaffScheduleInput,
  type StaffOverrideInput,
} from '@/lib/validation/admin';
import * as svc from '@/server/services/merchant-mutation-service';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

async function authz(permission: Permission, shopId: string): Promise<SessionUser & { tenantId: string }> {
  const user = await requirePermission(permission);
  if (!user.tenantId) throw Errors.forbidden('テナント管理者のみ操作できます。');
  assertShopAccess(user, shopId);
  return user as SessionUser & { tenantId: string };
}

async function audit(
  user: { id: string; tenantId: string },
  action: string,
  resourceType: string,
  resourceId: string | null,
  after?: unknown,
) {
  const meta = getRequestMeta();
  await writeAudit({
    tenantId: user.tenantId,
    actorUserId: user.id,
    action,
    resourceType,
    resourceId,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

// ---- スタッフ ----
export async function createStaffAction(shopId: string, input: StaffFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = staffFormSchema.parse(input);
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    const staff = await svc.createStaff(user.tenantId, shopId, data);
    await audit(user, 'staff.create', 'staff', staff.id, { name: staff.name });
    revalidatePath('/admin/staff');
    return { id: staff.id };
  });
}

export async function updateStaffAction(staffId: string, shopId: string, input: StaffFormInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = staffFormSchema.parse(input);
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    await svc.updateStaff(user.tenantId, shopId, staffId, data);
    await audit(user, 'staff.update', 'staff', staffId);
    revalidatePath('/admin/staff');
  });
}

export async function deleteStaffAction(staffId: string, shopId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    await svc.softDeleteStaff(user.tenantId, shopId, staffId);
    await audit(user, 'staff.delete', 'staff', staffId);
    revalidatePath('/admin/staff');
  });
}

/** スタッフにログインアカウント（メール＋パスワード）を発行/更新する。オーナーのみ。 */
export async function setStaffLoginAction(
  staffId: string,
  shopId: string,
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  return runAction(async () => {
    const data = staffLoginSchema.parse(input);
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    const result = await svc.setStaffLogin(user.tenantId, shopId, staffId, data.email, data.password);
    await audit(user, 'staff.login.set', 'staff', staffId, { email: result.email });
    revalidatePath(`/admin/staff/${staffId}`);
    return { email: result.email };
  });
}

/** スタッフのログインを無効化（アカウントを停止）する。オーナーのみ。 */
export async function disableStaffLoginAction(staffId: string, shopId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    await svc.disableStaffLogin(user.tenantId, shopId, staffId);
    await audit(user, 'staff.login.disable', 'staff', staffId);
    revalidatePath(`/admin/staff/${staffId}`);
  });
}

// ---- サービス ----
export async function createServiceAction(shopId: string, input: ServiceFormInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = serviceFormSchema.parse(input);
    const user = await authz(PERMISSIONS.SERVICE_WRITE, shopId);
    const service = await svc.createService(user.tenantId, shopId, data);
    await audit(user, 'service.create', 'service', service.id, { name: service.name });
    revalidatePath('/admin/services');
    return { id: service.id };
  });
}

export async function updateServiceAction(serviceId: string, shopId: string, input: ServiceFormInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = serviceFormSchema.parse(input);
    const user = await authz(PERMISSIONS.SERVICE_WRITE, shopId);
    await svc.updateService(user.tenantId, shopId, serviceId, data);
    await audit(user, 'service.update', 'service', serviceId);
    revalidatePath('/admin/services');
  });
}

export async function deleteServiceAction(serviceId: string, shopId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.SERVICE_WRITE, shopId);
    await svc.softDeleteService(user.tenantId, shopId, serviceId);
    await audit(user, 'service.delete', 'service', serviceId);
    revalidatePath('/admin/services');
  });
}

// ---- 店舗設定 ----
export async function updateShopSettingsAction(shopId: string, input: ShopSettingsInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = shopSettingsSchema.parse(input);
    const user = await authz(PERMISSIONS.SHOP_UPDATE, shopId);
    await svc.updateShopSettings(user.tenantId, shopId, data);
    await audit(user, 'shop.update', 'shop', shopId);
    revalidatePath('/admin/settings');
    revalidatePath('/admin');
  });
}

// ---- 特別営業日 ----
export async function addSpecialDayAction(shopId: string, input: SpecialDayInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = specialDaySchema.parse(input);
    const user = await authz(PERMISSIONS.SCHEDULE_WRITE, shopId);
    const sd = await svc.addSpecialDay(user.tenantId, shopId, data);
    await audit(user, 'specialDay.upsert', 'special_business_day', sd.id, { date: data.date, type: data.type });
    revalidatePath('/admin/calendar');
  });
}

export async function deleteSpecialDayAction(id: string, shopId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.SCHEDULE_WRITE, shopId);
    await svc.deleteSpecialDay(user.tenantId, shopId, id);
    await audit(user, 'specialDay.delete', 'special_business_day', id);
    revalidatePath('/admin/calendar');
  });
}

// ---- 容量ルール ----
export async function updateCapacityRuleAction(ruleId: string, shopId: string, input: CapacityRuleInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = capacityRuleSchema.parse(input);
    const user = await authz(PERMISSIONS.SCHEDULE_WRITE, shopId);
    await svc.updateCapacityRule(user.tenantId, shopId, ruleId, data);
    await audit(user, 'capacityRule.update', 'booking_capacity_rule', ruleId, data);
    revalidatePath('/admin/rules');
  });
}

// ---- スタッフシフト ----
export async function replaceStaffScheduleAction(staffId: string, shopId: string, input: StaffScheduleInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = staffScheduleSchema.parse(input);
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    await svc.replaceStaffRecurringSchedule(user.tenantId, shopId, staffId, data);
    await audit(user, 'staffSchedule.replace', 'staff_schedule', staffId, { count: data.rows.length });
    revalidatePath(`/admin/staff/${staffId}/schedule`);
  });
}

export async function addStaffOverrideAction(staffId: string, shopId: string, input: StaffOverrideInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = staffOverrideSchema.parse(input);
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    const ov = await svc.addStaffOverride(user.tenantId, shopId, staffId, data);
    await audit(user, 'staffSchedule.override', 'staff_schedule', ov.id, { date: data.date, isWorking: data.isWorking });
    revalidatePath(`/admin/staff/${staffId}/schedule`);
  });
}

export async function deleteStaffOverrideAction(scheduleId: string, staffId: string, shopId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await authz(PERMISSIONS.STAFF_WRITE, shopId);
    await svc.deleteStaffOverride(user.tenantId, shopId, scheduleId);
    await audit(user, 'staffSchedule.override.delete', 'staff_schedule', scheduleId);
    revalidatePath(`/admin/staff/${staffId}/schedule`);
  });
}

// ---- 店舗（複数店舗）----
export async function createShopAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const data = shopCreateSchema.parse(input);
    const user = await requirePermission(PERMISSIONS.SHOP_CREATE);
    if (!user.tenantId) throw Errors.forbidden('テナント管理者のみ操作できます。');
    const shop = await svc.createShop(user.tenantId, data);
    await audit({ id: user.id, tenantId: user.tenantId }, 'shop.create', 'shop', shop.id, { name: data.name, slug: data.slug });
    revalidatePath('/admin', 'layout');
    return { id: shop.id };
  });
}

// ---- 顧客カルテ ----
export async function updateCustomerNoteAction(customerId: string, note: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CUSTOMER_WRITE);
    if (!user.tenantId) throw Errors.forbidden('テナント管理者のみ操作できます。');
    const parsed = z.string().max(2000, 'メモは2000文字以内で入力してください。').parse(note);
    await svc.updateCustomerNote(user.tenantId, customerId, parsed);
    await audit({ id: user.id, tenantId: user.tenantId }, 'customer.note.update', 'customer', customerId);
    revalidatePath(`/admin/customers/${customerId}`);
  });
}

// ---- 営業時間 ----
export async function replaceBusinessHoursAction(shopId: string, input: BusinessHoursInput): Promise<ActionResult> {
  return runAction(async () => {
    const data = businessHoursSchema.parse(input);
    const user = await authz(PERMISSIONS.SCHEDULE_WRITE, shopId);
    await svc.replaceBusinessHours(user.tenantId, shopId, data);
    await audit(user, 'businessHours.replace', 'business_hours', shopId, { count: data.rows.length });
    revalidatePath('/admin/business-hours');
  });
}
