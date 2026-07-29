import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { listPublishedHomepageSlugs } from '@/server/services/shop-homepage-service';

// 公開ホームページ一覧はDB由来のため実行時生成。
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  let shops: { slug: string; updatedAt: Date }[] = [];
  try {
    shops = await listPublishedHomepageSlugs();
  } catch {
    shops = [];
  }
  return shops.map((s) => ({
    url: `${base}/${s.slug}`,
    lastModified: s.updatedAt,
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }));
}
