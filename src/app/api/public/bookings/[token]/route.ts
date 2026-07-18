import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { getBookingByToken } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req: NextRequest, ctx: { params: { token: string } }) => {
  const booking = await getBookingByToken(ctx.params.token);
  return jsonOk({ booking });
});
