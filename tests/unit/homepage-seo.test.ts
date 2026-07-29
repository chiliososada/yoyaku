import { describe, it, expect } from 'vitest';
import type { PublicHomepage } from '@/server/services/shop-homepage-service';
import {
  buildDescription,
  buildJsonLd,
  buildTitle,
  businessTypeSeoLabel,
  formatYen,
  groupHours,
  imageUrl,
  minutesToHHMM,
  priceRange,
} from '@/lib/homepage-seo';

function makeHp(overrides: Partial<PublicHomepage> = {}): PublicHomepage {
  return {
    shopId: 's1',
    tenantId: 't1',
    slug: 'beauty-tokyo',
    name: 'ビューティー東京',
    description: '渋谷の美容室です',
    phone: '03-1234-5678',
    postalCode: '150-0002',
    prefecture: '東京都',
    city: '渋谷区',
    address: '渋谷1-2-3',
    bookingEnabled: true,
    profile: {
      tagline: '髪から、あなたらしく。',
      about: null,
      businessType: 'HairSalon',
      heroImageKey: 'abc123.webp',
      logoImageKey: null,
      gallery: [],
      accessNote: null,
      themeColor: null,
      instagramUrl: 'https://instagram.com/x',
      lineUrl: null,
      xUrl: null,
      websiteUrl: null,
      showMenu: true,
      showStaff: true,
      showGallery: true,
      showAddress: true,
      seoTitle: null,
      seoDescription: null,
    },
    hours: [
      { dayOfWeek: 1, openMinute: 600, closeMinute: 1140 },
      { dayOfWeek: 2, openMinute: 600, closeMinute: 1140 },
    ],
    services: [
      { id: 'sv1', name: 'カット', description: null, category: 'ヘア', durationMin: 60, priceJpy: 5000, salePriceJpy: null },
      { id: 'sv2', name: 'カラー', description: null, category: 'ヘア', durationMin: 90, priceJpy: 12000, salePriceJpy: 9000 },
    ],
    staff: [],
    ...overrides,
  };
}

describe('homepage-seo helpers', () => {
  it('minutesToHHMM / formatYen', () => {
    expect(minutesToHHMM(600)).toBe('10:00');
    expect(minutesToHHMM(1140)).toBe('19:00');
    expect(minutesToHHMM(0)).toBe('00:00');
    expect(formatYen(12000)).toBe('¥12,000');
  });

  it('businessTypeSeoLabel maps schema types', () => {
    expect(businessTypeSeoLabel('HairSalon')).toBe('美容室');
    expect(businessTypeSeoLabel('NailSalon')).toBe('ネイルサロン');
    expect(businessTypeSeoLabel('Unknown')).toBe('サロン');
  });

  it('priceRange uses effective (sale) price and handles empty', () => {
    expect(priceRange(makeHp().services)).toBe('¥5,000〜¥9,000');
    expect(priceRange([])).toBeNull();
    expect(priceRange([{ priceJpy: 3000, salePriceJpy: null }])).toBe('¥3,000');
  });

  it('groupHours labels closed days', () => {
    const g = groupHours(makeHp().hours);
    expect(g).toHaveLength(7);
    expect(g[1]!.label).toBe('10:00〜19:00'); // Monday open
    expect(g[0]!.label).toBe('定休日'); // Sunday closed
  });

  it('buildTitle auto-generates from area + type, or uses override', () => {
    expect(buildTitle(makeHp())).toBe('ビューティー東京｜東京都渋谷区の美容室');
    const overridden = makeHp();
    overridden.profile.seoTitle = '手動タイトル';
    expect(buildTitle(overridden)).toBe('手動タイトル');
  });

  it('buildDescription falls back tagline → description and truncates', () => {
    expect(buildDescription(makeHp())).toBe('髪から、あなたらしく。');
    const noTagline = makeHp();
    noTagline.profile.tagline = null;
    expect(buildDescription(noTagline)).toBe('渋谷の美容室です');
    const long = makeHp();
    long.profile.seoDescription = 'あ'.repeat(300);
    expect(buildDescription(long).length).toBeLessThanOrEqual(158);
  });

  it('imageUrl builds absolute upload URL', () => {
    expect(imageUrl('https://x.test', 'a.webp')).toBe('https://x.test/uploads/a.webp');
    expect(imageUrl('https://x.test/', 'a.webp')).toBe('https://x.test/uploads/a.webp');
    expect(imageUrl('https://x.test', null)).toBeNull();
  });

  it('buildJsonLd produces a valid LocalBusiness graph', () => {
    const ld = buildJsonLd(makeHp(), 'https://yoyaku.test') as Record<string, unknown>;
    expect(ld['@type']).toBe('HairSalon');
    expect(ld.name).toBe('ビューティー東京');
    expect(ld.url).toBe('https://yoyaku.test/beauty-tokyo');
    expect(ld.image).toBe('https://yoyaku.test/uploads/abc123.webp');
    expect(ld.priceRange).toBe('¥5,000〜¥9,000');
    expect(ld.sameAs).toEqual(['https://instagram.com/x']);
    const addr = ld.address as Record<string, unknown>;
    expect(addr.addressRegion).toBe('東京都');
    expect(addr.addressCountry).toBe('JP');
    const spec = ld.openingHoursSpecification as { dayOfWeek: string[]; opens: string; closes: string }[];
    expect(spec).toHaveLength(1); // Mon+Tue same hours → grouped
    expect(spec[0]!.dayOfWeek).toEqual(['Monday', 'Tuesday']);
    expect(spec[0]!.opens).toBe('10:00');
    expect(spec[0]!.closes).toBe('19:00');
  });
});
