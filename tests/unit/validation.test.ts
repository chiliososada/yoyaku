/**
 * 入力検証スキーマの単体テスト（公開API入口の防御）。
 */
import { describe, it, expect } from 'vitest';
import {
  isoDateSchema,
  availabilityQuerySchema,
  dateAvailabilityQuerySchema,
  createBookingSchema,
} from '@/lib/validation/booking';
import { serviceFormSchema, shopHomepageSchema, shopCreateSchema } from '@/lib/validation/admin';
import { planFormSchema } from '@/lib/validation/platform';

describe('isoDateSchema', () => {
  it('実在する日付を受理する', () => {
    expect(isoDateSchema.safeParse('2026-07-05').success).toBe(true);
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true); // 閏年
  });

  it('形式不正を拒否する', () => {
    expect(isoDateSchema.safeParse('2026/07/05').success).toBe(false);
    expect(isoDateSchema.safeParse('26-7-5').success).toBe(false);
    expect(isoDateSchema.safeParse('').success).toBe(false);
  });

  it('存在しない暦日（ロールオーバー）を拒否する', () => {
    expect(isoDateSchema.safeParse('2026-02-31').success).toBe(false); // 2月31日
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(isoDateSchema.safeParse('2025-02-29').success).toBe(false); // 非閏年
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false); // 13月
    expect(isoDateSchema.safeParse('2026-00-10').success).toBe(false); // 0月
    expect(isoDateSchema.safeParse('2026-04-31').success).toBe(false); // 4月31日
  });
});

describe('availabilityQuerySchema', () => {
  it('serviceId 単一で有効', () => {
    const r = availabilityQuerySchema.safeParse({ serviceId: 'svc1', date: '2026-07-05' });
    expect(r.success).toBe(true);
  });

  it('serviceIds コンボ（カンマ区切り）で有効・最大3件', () => {
    expect(availabilityQuerySchema.safeParse({ serviceIds: 'a,b,c', date: '2026-07-05' }).success).toBe(true);
    expect(availabilityQuerySchema.safeParse({ serviceIds: 'a,b,c,d', date: '2026-07-05' }).success).toBe(false);
  });

  it('サービス未選択は拒否', () => {
    expect(availabilityQuerySchema.safeParse({ date: '2026-07-05' }).success).toBe(false);
  });

  it('不正日付は拒否', () => {
    expect(availabilityQuerySchema.safeParse({ serviceId: 'svc1', date: '2026-02-31' }).success).toBe(false);
  });
});

describe('dateAvailabilityQuerySchema', () => {
  it('days は 1..60、既定30', () => {
    expect(dateAvailabilityQuerySchema.parse({ serviceId: 's', from: '2026-07-05' }).days).toBe(30);
    expect(dateAvailabilityQuerySchema.safeParse({ serviceId: 's', from: '2026-07-05', days: 60 }).success).toBe(true);
    expect(dateAvailabilityQuerySchema.safeParse({ serviceId: 's', from: '2026-07-05', days: 61 }).success).toBe(false);
    expect(dateAvailabilityQuerySchema.safeParse({ serviceId: 's', from: '2026-07-05', days: 0 }).success).toBe(false);
  });
});

describe('createBookingSchema', () => {
  const customer = { name: '山田太郎', email: 'a@example.com' };

  it('serviceItems（最大3）+ 有効な startAt で受理', () => {
    const r = createBookingSchema.safeParse({
      serviceItems: [{ serviceId: 'a' }, { serviceId: 'b' }],
      startAt: '2026-07-05T01:00:00.000Z',
      customer,
    });
    expect(r.success).toBe(true);
  });

  it('serviceItems 4件は拒否', () => {
    const r = createBookingSchema.safeParse({
      serviceItems: [{ serviceId: 'a' }, { serviceId: 'b' }, { serviceId: 'c' }, { serviceId: 'd' }],
      startAt: '2026-07-05T01:00:00.000Z',
      customer,
    });
    expect(r.success).toBe(false);
  });

  it('startAt が非ISO(UTC)は拒否', () => {
    expect(createBookingSchema.safeParse({ serviceId: 'a', startAt: '2026-07-05 10:00', customer }).success).toBe(false);
  });

  it('連絡先（email/phone）が両方無いと拒否', () => {
    const r = createBookingSchema.safeParse({
      serviceId: 'a',
      startAt: '2026-07-05T01:00:00.000Z',
      customer: { name: '山田太郎' },
    });
    expect(r.success).toBe(false);
  });

  it('サービス未選択は拒否', () => {
    expect(createBookingSchema.safeParse({ startAt: '2026-07-05T01:00:00.000Z', customer }).success).toBe(false);
  });
});

describe('serviceFormSchema セール価格', () => {
  const base = { name: 'カット', durationMin: 60, priceJpy: 6000, requiresStaff: false, staffIds: [] };

  it('空欄なら salePriceJpy = null（セールなし）', () => {
    const r = serviceFormSchema.parse({ ...base, salePriceJpy: '' });
    expect(r.salePriceJpy).toBeNull();
  });

  it('通常料金より安ければ受理', () => {
    const r = serviceFormSchema.parse({ ...base, salePriceJpy: 5500 });
    expect(r.salePriceJpy).toBe(5500);
  });

  it('通常料金以上のセール価格は拒否', () => {
    expect(serviceFormSchema.safeParse({ ...base, salePriceJpy: 6000 }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ ...base, salePriceJpy: 7000 }).success).toBe(false);
  });
});

describe('shopHomepageSchema SNS URL（stored XSS 対策）', () => {
  const base = { businessType: 'HairSalon' as const, homepageEnabled: false, showMenu: true, showStaff: true, showGallery: true, showAddress: true, gallery: [] };

  it('http(s) の URL は受理', () => {
    expect(shopHomepageSchema.safeParse({ ...base, websiteUrl: 'https://example.com' }).success).toBe(true);
    expect(shopHomepageSchema.safeParse({ ...base, lineUrl: 'https://lin.ee/xyz' }).success).toBe(true);
    expect(shopHomepageSchema.safeParse({ ...base, instagramUrl: '' }).success).toBe(true);
  });

  it('javascript: / data: 等のスキームは拒否', () => {
    expect(shopHomepageSchema.safeParse({ ...base, websiteUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(shopHomepageSchema.safeParse({ ...base, xUrl: 'data:text/html,<script>alert(1)</script>' }).success).toBe(false);
    expect(shopHomepageSchema.safeParse({ ...base, instagramUrl: 'vbscript:msgbox(1)' }).success).toBe(false);
  });

  it('テーマカラーは #RRGGBB のみ', () => {
    expect(shopHomepageSchema.safeParse({ ...base, themeColor: '#7c3aed' }).success).toBe(true);
    expect(shopHomepageSchema.safeParse({ ...base, themeColor: 'red;background:url(x)' }).success).toBe(false);
  });
});

describe('planFormSchema 予約件数の無制限(0)', () => {
  const base = {
    name: 'テストプラン',
    priceJpy: 9800,
    maxShops: 3,
    maxStaffPerShop: 15,
    stripePriceId: '',
    isActive: true,
  };

  it('0 = 無制限 を保存できる（有料プランはこれを使う）', () => {
    const r = planFormSchema.safeParse({ ...base, maxBookingsPerMonth: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxBookingsPerMonth).toBe(0);
  });

  it('通常の件数上限も保存できる（フリー枠用）', () => {
    expect(planFormSchema.safeParse({ ...base, maxBookingsPerMonth: 100 }).success).toBe(true);
  });

  it('負数は拒否', () => {
    expect(planFormSchema.safeParse({ ...base, maxBookingsPerMonth: -1 }).success).toBe(false);
  });
});

describe('shopCreateSchema 予約語 slug', () => {
  it('予約語（admin/book等）は拒否、通常slugは受理', () => {
    expect(shopCreateSchema.safeParse({ name: 'X', slug: 'admin' }).success).toBe(false);
    expect(shopCreateSchema.safeParse({ name: 'X', slug: 'book' }).success).toBe(false);
    expect(shopCreateSchema.safeParse({ name: 'X', slug: 'my-salon' }).success).toBe(true);
  });
});
