/**
 * 店舗ホームページの SEO ヘルパー（純粋関数・テスト可能）。
 * タイトル/説明の自動生成、JSON-LD(LocalBusiness) 構築、営業時間の整形。
 */
import type { PublicHomepage } from '@/server/services/shop-homepage-service';

export const DAY_JP = ['日', '月', '火', '水', '木', '金', '土'] as const;
const DAY_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** schema.org のビジネス種別 → SEO タイトル用の短い日本語。 */
export function businessTypeSeoLabel(type: string): string {
  switch (type) {
    case 'HairSalon':
      return '美容室';
    case 'BeautySalon':
      return 'エステサロン';
    case 'NailSalon':
      return 'ネイルサロン';
    case 'DaySpa':
      return 'リラクゼーション';
    default:
      return 'サロン';
  }
}

export function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function formatYen(n: number): string {
  return `¥${new Intl.NumberFormat('ja-JP').format(n)}`;
}

/** 住所を1行に連結（郵便番号は含めない）。 */
export function addressLine(hp: Pick<PublicHomepage, 'prefecture' | 'city' | 'address'>): string {
  return [hp.prefecture, hp.city, hp.address].filter((s) => s && s.trim() !== '').join(' ');
}

/** 曜日ごとに営業時間を整形。昼休み等で複数区間ある日は連結。行が無い日は「定休日」。 */
export function groupHours(
  hours: { dayOfWeek: number; openMinute: number; closeMinute: number }[],
): { days: number[]; label: string }[] {
  const byDay = new Map<number, string[]>();
  for (const h of hours) {
    const arr = byDay.get(h.dayOfWeek) ?? [];
    arr.push(`${minutesToHHMM(h.openMinute)}〜${minutesToHHMM(h.closeMinute)}`);
    byDay.set(h.dayOfWeek, arr);
  }
  return [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const segs = byDay.get(d);
    return { days: [d], label: segs && segs.length > 0 ? segs.join('・') : '定休日' };
  });
}

/** SEO タイトル（手動上書きが無ければ自動生成）。 */
export function buildTitle(hp: PublicHomepage): string {
  if (hp.profile.seoTitle) return hp.profile.seoTitle;
  const area = [hp.prefecture, hp.city].filter(Boolean).join('');
  const label = businessTypeSeoLabel(hp.profile.businessType);
  return area ? `${hp.name}｜${area}の${label}` : `${hp.name}｜${label}`;
}

/** SEO 説明（手動上書き→キャッチコピー→紹介文→既定の順）。160字以内。 */
export function buildDescription(hp: PublicHomepage): string {
  const raw =
    hp.profile.seoDescription ||
    hp.profile.tagline ||
    hp.description ||
    `${hp.name}の予約ページ。${addressLine(hp)}`;
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > 158 ? `${oneLine.slice(0, 157)}…` : oneLine;
}

/** 画像キーを絶対URLに（OG/JSON-LD 用）。キー無しは null。 */
export function imageUrl(baseUrl: string, key: string | null): string | null {
  return key ? `${baseUrl.replace(/\/$/, '')}/uploads/${key}` : null;
}

/** サービス群から価格帯文字列（例「¥3,000〜¥12,000」）。無ければ null。 */
export function priceRange(services: { priceJpy: number; salePriceJpy: number | null }[]): string | null {
  const prices = services.map((s) => s.salePriceJpy ?? s.priceJpy).filter((n) => n > 0);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatYen(min) : `${formatYen(min)}〜${formatYen(max)}`;
}

/** LocalBusiness の JSON-LD を構築。 */
export function buildJsonLd(hp: PublicHomepage, baseUrl: string): Record<string, unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}/${hp.slug}`;
  const img = imageUrl(baseUrl, hp.profile.heroImageKey) ?? imageUrl(baseUrl, hp.profile.logoImageKey);
  const sameAs = [hp.profile.instagramUrl, hp.profile.xUrl, hp.profile.websiteUrl, hp.profile.lineUrl].filter(
    (u): u is string => !!u,
  );

  // 営業時間 → OpeningHoursSpecification（同一開閉をまとめる）。
  // 24:00 は schema.org の Time として無効のため 23:59 に丸める。
  const ldTime = (m: number) => minutesToHHMM(Math.min(m, 1439));
  const specMap = new Map<string, string[]>();
  for (const h of hp.hours) {
    const key = `${ldTime(h.openMinute)}-${ldTime(h.closeMinute)}`;
    const arr = specMap.get(key) ?? [];
    if (!arr.includes(DAY_SCHEMA[h.dayOfWeek]!)) arr.push(DAY_SCHEMA[h.dayOfWeek]!);
    specMap.set(key, arr);
  }
  const openingHoursSpecification = Array.from(specMap.entries()).map(([range, days]) => {
    const [opens, closes] = range.split('-');
    return { '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens, closes };
  });

  const address = {
    '@type': 'PostalAddress',
    ...(hp.postalCode ? { postalCode: hp.postalCode } : {}),
    ...(hp.prefecture ? { addressRegion: hp.prefecture } : {}),
    ...(hp.city ? { addressLocality: hp.city } : {}),
    ...(hp.address ? { streetAddress: hp.address } : {}),
    addressCountry: 'JP',
  };

  const range = priceRange(hp.services);

  return {
    '@context': 'https://schema.org',
    '@type': hp.profile.businessType || 'HealthAndBeautyBusiness',
    name: hp.name,
    description: buildDescription(hp),
    url,
    ...(hp.phone ? { telephone: hp.phone } : {}),
    ...(img ? { image: img } : {}),
    ...(addressLine(hp) ? { address } : {}),
    ...(openingHoursSpecification.length ? { openingHoursSpecification } : {}),
    ...(range ? { priceRange: range } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(hp.bookingEnabled ? { potentialAction: { '@type': 'ReserveAction', target: `${url}` } } : {}),
  };
}
