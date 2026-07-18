import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { Errors } from '@/lib/errors';
import { getBookingRescheduleContextByToken, getDayAvailability } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 顧客の自助改期用: この予約の構成で指定日の空き状況（自身の占有は除外）。 */
export const GET = route(async (req: NextRequest, ctx: { params: { token: string } }) => {
  const date = new URL(req.url).searchParams.get('date') ?? '';
  if (!DATE_RE.test(date)) throw Errors.validation('日付の形式が正しくありません。');

  const c = await getBookingRescheduleContextByToken(ctx.params.token);
  const result = await getDayAvailability({
    tenantId: c.tenantId,
    shopId: c.shopId,
    serviceItems: c.serviceItems,
    staffId: c.staffId, // 担当は維持
    date,
    excludeBookingId: c.bookingId,
  });
  return jsonOk({
    date: result.date,
    dayStatus: result.dayStatus,
    slots: result.slots.map((s) => ({ startAt: s.startAt.toISOString(), available: s.available, reason: s.reason })),
  });
});
