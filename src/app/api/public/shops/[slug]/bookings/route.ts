import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { createBookingSchema } from '@/lib/validation/booking';
import { resolveShopIds } from '@/server/services/public-shop-service';
import { createBooking } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

export const POST = route(async (req: NextRequest, ctx: { params: { slug: string } }) => {
  const body = createBookingSchema.parse(await req.json());
  const { tenantId, shopId } = await resolveShopIds(ctx.params.slug);

  const result = await createBooking({
    tenantId,
    shopId,
    serviceId: body.serviceId,
    serviceItems: body.serviceItems,
    staffId: body.staffId ?? null,
    startAt: new Date(body.startAt),
    customer: {
      name: body.customer.name,
      nameKana: body.customer.nameKana || null,
      email: body.customer.email || null,
      phone: body.customer.phone || null,
    },
    note: body.note || null,
    partySize: body.partySize,
    source: 'PUBLIC',
    idempotencyKey: body.idempotencyKey || null,
    lineUserId: body.lineUserId || null,
  });

  return jsonOk({ booking: result }, { status: 201 });
});
