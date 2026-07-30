'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission, assertShopAccess, type SessionUser } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { Errors } from '@/lib/errors';
import { writeAudit } from '@/server/services/audit-service';
import { adminBookingSchema } from '@/lib/validation/booking';
import {
  updateBookingStatus,
  getBookingTenantShop,
  getBookingForReschedule,
  type BookingStatus,
} from '@/server/services/booking-admin-service';
import { getDayAvailability, createBooking, rescheduleBooking } from '@/server/services/booking-service';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

async function tenantOf(user: SessionUser): Promise<string> {
  if (!user.tenantId) throw Errors.forbidden('テナント管理者のみ操作できます。');
  return user.tenantId;
}

const updateStatusSchema = z.object({
  bookingId: z.string().min(1),
  toStatus: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  reason: z.string().trim().max(500).optional(),
});

/** 予約状態を変更（完了/No-Show/キャンセル等）。 */
export async function updateBookingStatusAction(input: {
  bookingId: string;
  toStatus: BookingStatus;
  reason?: string;
}): Promise<ActionResult<{ status: BookingStatus }>> {
  return runAction(async () => {
    const parsed = updateStatusSchema.parse(input);
    // キャンセルは BOOKING_CANCEL、それ以外は BOOKING_UPDATE
    const perm = parsed.toStatus === 'CANCELLED' ? PERMISSIONS.BOOKING_CANCEL : PERMISSIONS.BOOKING_UPDATE;
    const user = await requirePermission(perm);

    const owner = await getBookingTenantShop(parsed.bookingId);
    if (!owner) throw Errors.notFound('予約が見つかりません。');
    if (!user.isPlatformAdmin && owner.tenantId !== user.tenantId) throw Errors.forbidden();
    assertShopAccess(user, owner.shopId);

    const result = await updateBookingStatus({
      tenantId: owner.tenantId,
      bookingId: parsed.bookingId,
      toStatus: parsed.toStatus,
      actorUserId: user.id,
      reason: parsed.reason ?? null,
    });

    const meta = getRequestMeta();
    await writeAudit({
      tenantId: owner.tenantId,
      actorUserId: user.id,
      action: `booking.status.${parsed.toStatus.toLowerCase()}`,
      resourceType: 'booking',
      resourceId: parsed.bookingId,
      before: { status: result.before },
      after: { status: result.status },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath('/admin/bookings');
    revalidatePath(`/admin/bookings/${parsed.bookingId}`);
    return { status: result.status };
  });
}

export interface AdminSlot {
  startAt: string;
  available: boolean;
  remaining: number;
  reason?: string;
}

/** 改期用: この予約の構成で指定日の空き状況（自身の占有は除外）。 */
export async function rescheduleAvailabilityAction(
  bookingId: string,
  date: string,
  staffId: string | null,
): Promise<ActionResult<{ dayStatus: string; slots: AdminSlot[] }>> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);
    const owner = await getBookingTenantShop(bookingId);
    if (!owner) throw Errors.notFound('予約が見つかりません。');
    if (!user.isPlatformAdmin && owner.tenantId !== user.tenantId) throw Errors.forbidden();
    assertShopAccess(user, owner.shopId);
    const info = await getBookingForReschedule(owner.tenantId, bookingId);
    const result = await getDayAvailability({
      tenantId: owner.tenantId,
      shopId: owner.shopId,
      serviceItems: info.serviceItems,
      staffId,
      date,
      excludeBookingId: bookingId,
      // 後台からの代理改期。締切・受付期間は顧客向けのルールなので適用しない
      enforceTimeRules: false,
    });
    return {
      dayStatus: result.dayStatus,
      slots: result.slots.map((s) => ({ startAt: s.startAt.toISOString(), available: s.available, remaining: s.remaining, reason: s.reason })),
    };
  });
}

const rescheduleSchema = z.object({
  bookingId: z.string().min(1),
  startAt: z.string().datetime(),
  staffId: z.string().min(1).nullable(),
});

/** 管理画面から予約を改期（日時/担当変更）。 */
export async function rescheduleBookingAction(input: unknown): Promise<ActionResult<{ startAt: string }>> {
  return runAction(async () => {
    const parsed = rescheduleSchema.parse(input);
    const user = await requirePermission(PERMISSIONS.BOOKING_UPDATE);
    const owner = await getBookingTenantShop(parsed.bookingId);
    if (!owner) throw Errors.notFound('予約が見つかりません。');
    if (!user.isPlatformAdmin && owner.tenantId !== user.tenantId) throw Errors.forbidden();
    assertShopAccess(user, owner.shopId);

    const result = await rescheduleBooking({
      bookingId: parsed.bookingId,
      newStartAt: new Date(parsed.startAt),
      newStaffId: parsed.staffId,
      actorType: 'USER',
      actorUserId: user.id,
      enforceDeadline: false,
    });

    const meta = getRequestMeta();
    await writeAudit({
      tenantId: owner.tenantId,
      actorUserId: user.id,
      action: 'booking.reschedule',
      resourceType: 'booking',
      resourceId: parsed.bookingId,
      after: { startAt: parsed.startAt, staffId: parsed.staffId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath('/admin/bookings');
    revalidatePath(`/admin/bookings/${parsed.bookingId}`);
    return { startAt: result.startAt.toISOString() };
  });
}

/** 管理画面の代理予約用: 指定日の空き状況。 */
export async function adminAvailabilityAction(
  shopId: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<ActionResult<{ dayStatus: string; slots: AdminSlot[] }>> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.BOOKING_READ);
    const tenantId = await tenantOf(user);
    assertShopAccess(user, shopId);
    // 店主の代理登録では締切・受付期間を適用しない。
    // 「13:30に電話が来て今日の14:00を入れたい」は毎日ある業務で、
    // 客のネット駆け込みを防ぐためのルールでこれを止めると台帳が使えない。
    const result = await getDayAvailability({
      tenantId, shopId, serviceId, staffId, date, enforceTimeRules: false,
    });
    return {
      dayStatus: result.dayStatus,
      slots: result.slots.map((s) => ({
        startAt: s.startAt.toISOString(),
        available: s.available,
        remaining: s.remaining,
        reason: s.reason,
      })),
    };
  });
}

/** 管理画面からの代理予約作成（source=ADMIN）。 */
export async function adminCreateBookingAction(
  shopId: string,
  input: unknown,
): Promise<ActionResult<{ bookingId: string }>> {
  return runAction(async () => {
    const data = adminBookingSchema.parse(input);
    const user = await requirePermission(PERMISSIONS.BOOKING_CREATE);
    const tenantId = await tenantOf(user);
    assertShopAccess(user, shopId);

    const booking = await createBooking({
      tenantId,
      shopId,
      serviceId: data.serviceId,
      staffId: data.staffId ?? null,
      startAt: new Date(data.startAt),
      customer: {
        name: data.customer.name,
        nameKana: data.customer.nameKana || null,
        email: data.customer.email || null,
        phone: data.customer.phone || null,
      },
      note: data.note || null,
      partySize: data.partySize,
      source: 'ADMIN',
      createdByUserId: user.id,
    });

    const meta = getRequestMeta();
    await writeAudit({
      tenantId,
      actorUserId: user.id,
      action: 'booking.create.admin',
      resourceType: 'booking',
      resourceId: booking.id,
      after: { startAt: data.startAt, serviceId: data.serviceId },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    revalidatePath('/admin/bookings');
    return { bookingId: booking.id };
  });
}
