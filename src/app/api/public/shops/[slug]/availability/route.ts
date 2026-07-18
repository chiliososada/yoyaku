import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { availabilityQuerySchema } from '@/lib/validation/booking';
import { resolveShopIds } from '@/server/services/public-shop-service';
import { getDayAvailability } from '@/server/services/booking-service';

export const dynamic = 'force-dynamic';

export const GET = route(async (req: NextRequest, ctx: { params: { slug: string } }) => {
  const sp = req.nextUrl.searchParams;
  const query = availabilityQuerySchema.parse({
    serviceId: sp.get('serviceId') ?? undefined,
    serviceIds: sp.get('serviceIds') ?? undefined,
    optionIds: sp.get('optionIds') ?? undefined,
    staffId: sp.get('staffId') ?? undefined,
    date: sp.get('date') ?? undefined,
  });

  const { tenantId, shopId } = await resolveShopIds(ctx.params.slug);
  const serviceIds = query.serviceIds ?? (query.serviceId ? [query.serviceId] : []);
  const result = await getDayAvailability({
    tenantId,
    shopId,
    serviceItems: serviceIds.map((id, i) => ({
      serviceId: id,
      // オプションは自身の serviceId で自動割当されるため先頭に付けるだけでよい
      optionIds: i === 0 ? (query.optionIds ?? []) : [],
    })),
    staffId: query.staffId ?? null,
    date: query.date,
  });

  return jsonOk(result);
});
