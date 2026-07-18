import type { NextRequest } from 'next/server';
import { route, jsonOk } from '@/lib/api';
import { getPublicShop } from '@/server/services/public-shop-service';

export const dynamic = 'force-dynamic';

export const GET = route(async (_req: NextRequest, ctx: { params: { slug: string } }) => {
  const shop = await getPublicShop(ctx.params.slug);
  return jsonOk({ shop });
});
