/**
 * 管理画面からの予約操作（状態管理など）。tenantId スコープで隔離。
 * 状態遷移はトランザクション内で行い、booking_events に記録。
 * CANCELLED/NO_SHOW は status 変更トリガで booking_items.active=false となり占有が解放される。
 */
import { prisma, type DbClient } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { nowUtc } from '@/lib/time';

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'NO_SHOW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const EVENT_TYPE: Record<BookingStatus, 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
};

export interface UpdateStatusInput {
  tenantId: string;
  bookingId: string;
  toStatus: BookingStatus;
  actorUserId?: string | null;
  reason?: string | null;
}

export async function updateBookingStatus(
  input: UpdateStatusInput,
): Promise<{ id: string; status: BookingStatus; before: BookingStatus }> {
  const now = nowUtc();

  return prisma.$transaction(async (tx: DbClient) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: input.tenantId, deletedAt: null },
      select: { id: true, status: true, customerEmail: true, customerLineUserId: true },
    });
    if (!booking) throw Errors.notFound('予約が見つかりません。');

    const from = booking.status as BookingStatus;
    if (from === input.toStatus) {
      return { id: booking.id, status: from, before: from };
    }
    if (!ALLOWED_TRANSITIONS[from].includes(input.toStatus)) {
      throw Errors.conflict(
        'INVALID_BOOKING_STATE',
        `現在の状態（${from}）から「${input.toStatus}」へは変更できません。`,
      );
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: input.toStatus,
        ...(input.toStatus === 'CANCELLED' ? { cancelledAt: now, cancelReason: input.reason ?? null } : {}),
        ...(input.toStatus === 'CONFIRMED' ? { confirmedAt: now } : {}),
      },
    });

    await tx.bookingEvent.create({
      data: {
        tenantId: input.tenantId,
        bookingId: booking.id,
        type: EVENT_TYPE[input.toStatus],
        fromStatus: from,
        toStatus: input.toStatus,
        actorType: 'USER',
        actorId: input.actorUserId ?? null,
        payload: { reason: input.reason ?? null },
      },
    });

    // キャンセル/No-Show: 未送信リマインドを無効化 + キャンセル通知
    if (input.toStatus === 'CANCELLED' || input.toStatus === 'NO_SHOW') {
      await tx.notificationJob.updateMany({
        where: { bookingId: booking.id, template: 'BOOKING_REMINDER', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    }
    if (input.toStatus === 'CANCELLED') {
      // 店側キャンセルは顧客へ必ず通知（LINE 経由予約は LINE、それ以外はメール。宛先なしは worker がスキップ）
      await tx.notificationJob.create({
        data: {
          tenantId: input.tenantId,
          bookingId: booking.id,
          channel: booking.customerLineUserId ? 'LINE' : 'EMAIL',
          template: 'BOOKING_CANCELLED',
          recipient: booking.customerLineUserId ?? booking.customerEmail ?? '',
          status: 'PENDING',
          payload: { bookingId: booking.id, by: 'admin' },
        },
      });
    }

    return { id: booking.id, status: input.toStatus, before: from };
  });
}

/** 予約の所属（テナント/店舗）。アクセス判定に使用。 */
export async function getBookingTenantShop(bookingId: string) {
  return prisma.booking.findFirst({
    where: { id: bookingId, deletedAt: null },
    select: { tenantId: true, shopId: true },
  });
}

/** 改期フォーム用: 予約の構成（サービス/オプション）・現担当・担当候補を返す。 */
export async function getBookingForReschedule(tenantId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tenantId, deletedAt: null },
    select: {
      id: true,
      status: true,
      startAt: true,
      staffId: true,
      shop: { select: { id: true, timezone: true } },
      items: { orderBy: { sortOrder: 'asc' }, select: { serviceId: true, options: { select: { optionId: true } } } },
    },
  });
  if (!booking) throw Errors.notFound('予約が見つかりません。');

  const seen = new Set<string>();
  const serviceItems: { serviceId: string; optionIds: string[] }[] = [];
  for (const it of booking.items) {
    if (seen.has(it.serviceId)) continue;
    seen.add(it.serviceId);
    serviceItems.push({ serviceId: it.serviceId, optionIds: it.options.map((o) => o.optionId).filter((x): x is string => !!x) });
  }

  const staffOptions = await prisma.staff.findMany({
    where: { tenantId, shopId: booking.shop.id, status: 'ACTIVE', isBookable: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, displayName: true },
  });

  return {
    id: booking.id,
    status: booking.status,
    startAt: booking.startAt,
    staffId: booking.staffId,
    shopId: booking.shop.id,
    timezone: booking.shop.timezone,
    serviceItems,
    staffOptions: staffOptions.map((s) => ({ id: s.id, name: s.displayName ?? s.name })),
  };
}

/** 管理画面の予約詳細（tenant スコープ + イベント履歴）。 */
export async function getBookingForAdmin(tenantId: string, bookingId: string) {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tenantId, deletedAt: null },
    select: {
      id: true,
      status: true,
      source: true,
      startAt: true,
      endAt: true,
      totalPriceJpy: true,
      partySize: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      note: true,
      cancellationToken: true,
      createdAt: true,
      shop: { select: { id: true, name: true, timezone: true } },
      service: { select: { name: true } },
      staff: { select: { name: true, displayName: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, startAt: true, endAt: true, serviceEndAt: true, active: true },
      },
      events: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, fromStatus: true, toStatus: true, actorType: true, createdAt: true },
      },
    },
  });
  if (!booking) throw Errors.notFound('予約が見つかりません。');
  return booking;
}
