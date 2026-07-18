import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { cancelBookingSchema } from '@/lib/validation/booking';
import { cancelBooking } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

export const POST = route(async (req: NextRequest, ctx: { params: { token: string } }) => {
  const raw = await req.json().catch(() => ({}));
  const body = cancelBookingSchema.parse(raw);
  const result = await cancelBooking({
    token: ctx.params.token,
    reason: body.reason ?? null,
    actorType: 'CUSTOMER',
  });
  return jsonOk({ booking: result });
});
