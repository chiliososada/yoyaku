import { describe, it, expect } from 'vitest';
import { isReservedSlug } from '@/lib/shop-slug';

describe('isReservedSlug', () => {
  it('reserves current top-level routes', () => {
    for (const s of ['admin', 'api', 'book', 'booking', 'platform', 'guide', 'legal', 'login']) {
      expect(isReservedSlug(s)).toBe(true);
    }
  });

  it('reserves system/serving paths', () => {
    for (const s of ['uploads', 'sitemap', 'sitemap.xml', 'robots.txt', 'favicon', '_next', 's']) {
      expect(isReservedSlug(s)).toBe(true);
    }
  });

  it('is case-insensitive and trims', () => {
    expect(isReservedSlug('ADMIN')).toBe(true);
    expect(isReservedSlug('  Book  ')).toBe(true);
  });

  it('allows normal shop slugs', () => {
    for (const s of ['beauty-tokyo', 'my-salon', 'hair123', 'relax-shibuya', 'nail-osaka']) {
      expect(isReservedSlug(s)).toBe(false);
    }
  });
});
