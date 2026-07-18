import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { dateAvailabilityQuerySchema } from '@/lib/validation/booking';
import { resolveShopIds } from '@/server/services/public-shop-service';
import { getDateAvailabilitySummary } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

export const GET = route(async (req: NextRequest, ctx: { params: { slug: string } }) => {
  const sp = req.nextUrl.searchParams;
  const query = dateAvailabilityQuerySchema.parse({
    serviceId: sp.get('serviceId') ?? undefined,
    serviceIds: sp.get('serviceIds') ?? undefined,
    optionIds: sp.get('optionIds') ?? undefined,
    staffId: sp.get('staffId') ?? undefined,
    from: sp.get('from') ?? undefined,
    days: sp.get('days') ?? undefined,
  });

  const { tenantId, shopId } = await resolveShopIds(ctx.params.slug);
  const serviceIds = query.serviceIds ?? (query.serviceId ? [query.serviceId] : []);
  const dates = await getDateAvailabilitySummary({
    tenantId,
    shopId,
    serviceItems: serviceIds.map((id, i) => ({
      serviceId: id,
      // オプションは自身の serviceId で自動割当されるため先頭に付けるだけでよい
      optionIds: i === 0 ? (query.optionIds ?? []) : [],
    })),
    staffId: query.staffId ?? null,
    fromDate: query.from,
    days: query.days,
  });

  return jsonOk({ dates });
});
