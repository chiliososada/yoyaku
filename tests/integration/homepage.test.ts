/**
 * 店舗ホームページ（専属HP）サービスの統合テスト（実DB）。
 * 公開ゲート（PUBLISHED かつ homepageEnabled）・upsert・サイトマップ列挙を検証。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  getHomepageForEditor,
  getHomepagePreview,
  getPublicHomepage,
  listPublishedHomepageSlugs,
  saveHomepage,
} from '@/server/services/shop-homepage-service';
import type { ShopHomepageInput } from '@/lib/validation/admin';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
let tenantId: string;
let shopId: string;
let slug: string;

function input(overrides: Partial<ShopHomepageInput> = {}): ShopHomepageInput {
  return {
    tagline: 'テストコピー',
    about: 'テスト紹介文',
    businessType: 'HairSalon',
    accessNote: '',
    themeColor: '',
    instagramUrl: '',
    lineUrl: '',
    xUrl: '',
    websiteUrl: '',
    homepageEnabled: true,
    showMenu: true,
    showStaff: true,
    showGallery: true,
    showAddress: true,
    seoTitle: '',
    seoDescription: '',
    heroImageKey: '',
    logoImageKey: '',
    gallery: [],
    ...overrides,
  };
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  tenantId = sc.tenantId;
  shopId = sc.shopId;
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, select: { slug: true } });
  slug = shop.slug;
});

afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

describe('shop homepage service', () => {
  it('editor returns empty defaults before any profile exists', async () => {
    const { data } = await getHomepageForEditor(tenantId, shopId);
    expect(data.homepageEnabled).toBe(false);
    expect(data.businessType).toBe('HealthAndBeautyBusiness');
    expect(data.gallery).toEqual([]);
  });

  it('public homepage is null before enabled', async () => {
    expect(await getPublicHomepage(slug)).toBeNull();
  });

  it('saveHomepage upserts and getPublicHomepage returns full data once enabled', async () => {
    await saveHomepage(tenantId, shopId, input({ tagline: 'こだわりの一軒' }));
    const hp = await getPublicHomepage(slug);
    expect(hp).not.toBeNull();
    expect(hp!.profile.tagline).toBe('こだわりの一軒');
    expect(hp!.name).toContain('Test Shop');
    expect(hp!.services.length).toBeGreaterThan(0); // seedScenario の1メニュー
    expect(hp!.staff.length).toBeGreaterThan(0);
    expect(hp!.hours.length).toBe(7);
  });

  it('sitemap lists the slug while published + enabled', async () => {
    const slugs = await listPublishedHomepageSlugs();
    expect(slugs.map((s) => s.slug)).toContain(slug);
  });

  it('hides sections when toggled off', async () => {
    await saveHomepage(tenantId, shopId, input({ showMenu: false, showStaff: false }));
    const hp = await getPublicHomepage(slug);
    expect(hp!.services).toEqual([]);
    expect(hp!.staff).toEqual([]);
  });

  it('is gated off when homepageEnabled=false', async () => {
    await saveHomepage(tenantId, shopId, input({ homepageEnabled: false }));
    expect(await getPublicHomepage(slug)).toBeNull();
    const slugs = await listPublishedHomepageSlugs();
    expect(slugs.map((s) => s.slug)).not.toContain(slug);
  });

  it('hides address fields server-side when showAddress=false', async () => {
    await prisma.shop.update({
      where: { id: shopId },
      data: { prefecture: '東京都', city: '渋谷区', address: '1-2-3', postalCode: '150-0002' },
    });
    await saveHomepage(tenantId, shopId, input({ showAddress: false }));
    const hp = await getPublicHomepage(slug);
    expect(hp!.prefecture).toBeNull();
    expect(hp!.city).toBeNull();
    expect(hp!.address).toBeNull();
    expect(hp!.postalCode).toBeNull();
    // 再表示
    await saveHomepage(tenantId, shopId, input({ showAddress: true }));
    const hp2 = await getPublicHomepage(slug);
    expect(hp2!.address).toBe('1-2-3');
  });

  /**
   * 「住所を表示する」OFF はホームページだけでなく**予約ページ・公開API**にも効く必要がある。
   * ここが漏れていると、自宅サロンの店主が住所を隠したつもりでも /book/{slug} から
   * 番地まで見え続け、本人はそれに気づけない。
   */
  it('hides the address on the booking page and public API too, not just the homepage', async () => {
    const { getPublicShop } = await import('@/server/services/public-shop-service');
    await prisma.shop.update({
      where: { id: shopId },
      data: { prefecture: '東京都', city: '渋谷区', address: '1-2-3' },
    });

    await saveHomepage(tenantId, shopId, input({ showAddress: false }));
    const hidden = await getPublicShop(slug);
    expect(hidden.address).toBeNull();
    expect(hidden.city).toBeNull();
    // 都道府県は検索性のため残す（ホームページ側と方針を揃える）
    expect(hidden.prefecture).toBe('東京都');

    await saveHomepage(tenantId, shopId, input({ showAddress: true }));
    const shown = await getPublicShop(slug);
    expect(shown.address).toBe('1-2-3');
    expect(shown.city).toBe('渋谷区');
  });

  it('is gated off when the shop is not PUBLISHED even if enabled', async () => {
    await saveHomepage(tenantId, shopId, input({ homepageEnabled: true }));
    await prisma.shop.update({ where: { id: shopId }, data: { status: 'DRAFT' } });
    expect(await getPublicHomepage(slug)).toBeNull();
    await prisma.shop.update({ where: { id: shopId }, data: { status: 'PUBLISHED' } });
    expect(await getPublicHomepage(slug)).not.toBeNull();
  });
});

describe('休業情報がホームページ側にも届く', () => {
  it('祝日休業ONなら closeOnNationalHolidays と直近の祝日が返る', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { closeOnNationalHolidays: true } });
    await saveHomepage(tenantId, shopId, input());
    const hp = await getPublicHomepage(slug);
    expect(hp!.closeOnNationalHolidays).toBe(true);
    // 60日以内に祝日が1つも無い期間は日本には存在しないため、必ず1件以上返る
    expect(hp!.upcomingHolidays.length).toBeGreaterThan(0);
  });

  it('祝日休業OFFなら祝日一覧は空（営業しているので出す必要がない）', async () => {
    await prisma.shop.update({ where: { id: shopId }, data: { closeOnNationalHolidays: false } });
    const hp = await getPublicHomepage(slug);
    expect(hp!.closeOnNationalHolidays).toBe(false);
    expect(hp!.upcomingHolidays).toEqual([]);
  });

  it('直近の臨時休業が specialDays に載る（過去分は載らない）', async () => {
    const day = (offset: number) =>
      new Date(new Date().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const soon = day(10);
    const past = day(-10);
    for (const [date, reason] of [
      [soon, '研修のため'],
      [past, '過去の休業'],
    ] as const) {
      await prisma.specialBusinessDay.create({
        data: { tenantId, shopId, date: new Date(`${date}T00:00:00.000Z`), type: 'CLOSED', reason },
      });
    }
    const hp = await getPublicHomepage(slug);
    const dates = hp!.specialDays.map((s) => s.date);
    expect(dates).toContain(soon);
    expect(dates).not.toContain(past);
  });
});

describe('下書きプレビュー（未公開でも見られる）', () => {
  it('homepageEnabled=false でもプレビューは中身を返す', async () => {
    await saveHomepage(tenantId, shopId, input({ homepageEnabled: false, tagline: '下書き中' }));
    expect(await getPublicHomepage(slug)).toBeNull();
    const hp = await getHomepagePreview(tenantId, shopId);
    expect(hp).not.toBeNull();
    expect(hp!.preview).toBe(true);
    expect(hp!.profile.tagline).toBe('下書き中');
  });

  it('他テナントの店舗は覗けない', async () => {
    const other = await seedScenario({ staffCount: 1 });
    createdTenants.push(other.tenantId);
    expect(await getHomepagePreview(other.tenantId, shopId)).toBeNull();
  });
});
