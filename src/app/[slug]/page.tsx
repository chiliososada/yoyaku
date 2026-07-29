import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import * as React from 'react';
import { env } from '@/lib/env';
import { isReservedSlug } from '@/lib/shop-slug';
import { getPublicHomepage } from '@/server/services/shop-homepage-service';
import { buildDescription, buildJsonLd, buildTitle, imageUrl } from '@/lib/homepage-seo';
import { Storefront } from '@/components/homepage/storefront';

// 編集内容を即時反映し、常に最新をクローラへ返す（低トラフィック前提）。
export const dynamic = 'force-dynamic';

const BASE = env.APP_BASE_URL;

// generateMetadata とページ本体で同一リクエスト中の二重DBアクセスを防ぐ。
// React.cache は Next のサーバー用 React にのみ存在（安定版 18 には無い）ため、無ければ素通し。
const dedupe =
  (React as unknown as { cache?: <T extends (slug: string) => Promise<unknown>>(fn: T) => T }).cache ??
  (<T,>(fn: T): T => fn);
const loadHomepage = dedupe(getPublicHomepage);

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  if (isReservedSlug(params.slug)) return { title: 'ページが見つかりません', robots: { index: false, follow: false } };
  const hp = await loadHomepage(params.slug);
  if (!hp) return { title: 'ページが見つかりません', robots: { index: false, follow: false } };

  const title = buildTitle(hp);
  const description = buildDescription(hp);
  const url = `${BASE.replace(/\/$/, '')}/${hp.slug}`;
  const ogImage = imageUrl(BASE, hp.profile.heroImageKey) ?? imageUrl(BASE, hp.profile.logoImageKey);

  return {
    metadataBase: new URL(BASE),
    // 店舗の白標ページのためレイアウトの「%s | Yoyaku」テンプレートを適用しない
    title: { absolute: title },
    description,
    // ルート層の noindex を明示的に上書き（このページのみクロール許可）
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      siteName: hp.name,
      locale: 'ja_JP',
      ...(ogImage ? { images: [{ url: ogImage, width: 1600, height: 900, alt: hp.name }] } : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function ShopHomepage({ params }: { params: { slug: string } }) {
  if (isReservedSlug(params.slug)) notFound();
  const hp = await loadHomepage(params.slug);
  if (!hp) notFound();

  const jsonLd = JSON.stringify(buildJsonLd(hp, BASE)).replace(/</g, '\\u003c');

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <Storefront hp={hp} />
    </>
  );
}
