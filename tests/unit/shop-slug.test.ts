import { describe, it, expect } from 'vitest';
import { isReservedSlug } from '@/lib/shop-slug';
import { shopSlugSchema, shopCreateSchema } from '@/lib/validation/admin';

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

describe('shopSlugSchema（公開URLの検証）', () => {
  const ok = (v: string) => shopSlugSchema.safeParse(v);
  const msg = (v: string) => {
    const r = shopSlugSchema.safeParse(v);
    return r.success ? null : r.error.issues[0]!.message;
  };

  it('大文字は弾かずに小文字へ倒す（屋号をそのまま打った店主を止めない）', () => {
    expect(ok('Shinbashi').success).toBe(true);
    expect(ok('Shinbashi').success && shopSlugSchema.parse('Shinbashi')).toBe('shinbashi');
    expect(shopSlugSchema.parse('  Hair-Salon-TOKYO  ')).toBe('hair-salon-tokyo');
  });

  it('通常のURLを許可する', () => {
    for (const s of ['shinbashi', 'my-salon', 'hair123', 'ab', 'shop-4f091718']) {
      expect(ok(s).success).toBe(true);
    }
  });

  it('日本語・空白・記号は拒否し、理由が日本語で返る', () => {
    for (const s of ['新橋店', 'my salon', 'salon_tokyo', 'salon.tokyo', 'サロン']) {
      const r = ok(s);
      expect(r.success).toBe(false);
      expect(msg(s)).toContain('URL');
    }
  });

  it('先頭・末尾のハイフンを拒否する（名刺に載せる文字列として体裁が悪い）', () => {
    for (const s of ['-shinbashi', 'shinbashi-', '-', '--', '---']) {
      expect(ok(s).success).toBe(false);
    }
    // 途中のハイフンは許可
    expect(ok('a-b').success).toBe(true);
  });

  it('長さの範囲を守る', () => {
    expect(ok('a').success).toBe(false);
    expect(ok('ab').success).toBe(true);
    expect(ok('a'.repeat(50)).success).toBe(true);
    expect(ok('a'.repeat(51)).success).toBe(false);
  });

  it('予約語を拒否する（大文字で来ても小文字化後に判定される）', () => {
    for (const s of ['admin', 'book', 'api', 'ADMIN', 'Sitemap']) {
      expect(ok(s).success).toBe(false);
    }
    // 予約語を含むだけなら許可（完全一致のみ禁止）
    expect(ok('admin-salon').success).toBe(true);
  });

  it('作成時と変更時で同じ規則を使う（片方だけ緩いと作れたのに保存できない）', () => {
    const created = shopCreateSchema.safeParse({ name: '新橋店', slug: 'Shinbashi', timezone: 'Asia/Tokyo' });
    expect(created.success).toBe(true);
    expect(created.success && created.data.slug).toBe('shinbashi');
    // 作成を通った値は、設定画面の検証も必ず通る
    expect(shopSlugSchema.safeParse(created.success ? created.data.slug : '').success).toBe(true);
  });
});
