import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { route, jsonOk } from '@/lib/api';
import { getBookingRescheduleContextByToken, rescheduleBooking } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

const schema = z.object({ startAt: z.string().datetime() });

/** 顧客の自助改期。担当は維持。変更期限（=キャンセル期限）を強制。 */
export const POST = route(async (req: NextRequest, ctx: { params: { token: string } }) => {
  const body = schema.parse(await req.json().catch(() => ({})));
  const c = await getBookingRescheduleContextByToken(ctx.params.token);
  const result = await rescheduleBooking({
    bookingId: c.bookingId,
    newStartAt: new Date(body.startAt),
    actorType: 'CUSTOMER',
    enforceDeadline: true,
  });
  return jsonOk({ booking: { startAt: result.startAt.toISOString() } });
});
