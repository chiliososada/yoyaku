/**
 * 店舗の「専属ホームページ」（SEO公開ページ）向けサービス。
 * - 編集用: getHomepageForEditor / saveHomepage（ShopProfile を upsert）
 * - 公開用: getPublicHomepage（公開かつ homepageEnabled のみ。店舗情報＋メニュー＋スタッフ＋営業時間）
 * - サイトマップ用: listPublishedHomepageSlugs
 */
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { deleteImage } from '@/server/uploads';
import type { ShopHomepageInput } from '@/lib/validation/admin';

/** 編集フォームの初期値（プロフィール未作成でも空値で成立）。 */
export interface HomepageEditorData {
  tagline: string;
  about: string;
  businessType: string;
  accessNote: string;
  themeColor: string;
  instagramUrl: string;
  lineUrl: string;
  xUrl: string;
  websiteUrl: string;
  homepageEnabled: boolean;
  showMenu: boolean;
  showStaff: boolean;
  showGallery: boolean;
  showAddress: boolean;
  seoTitle: string;
  seoDescription: string;
  heroImageKey: string;
  logoImageKey: string;
  gallery: string[];
}

function toGallery(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export async function getHomepageForEditor(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      publicBookingEnabled: true,
      profile: true,
    },
  });
  if (!shop) throw Errors.notFound('店舗が見つかりません。');
  const p = shop.profile;
  const data: HomepageEditorData = {
    tagline: p?.tagline ?? '',
    about: p?.about ?? '',
    businessType: p?.businessType ?? 'HealthAndBeautyBusiness',
    accessNote: p?.accessNote ?? '',
    themeColor: p?.themeColor ?? '',
    instagramUrl: p?.instagramUrl ?? '',
    lineUrl: p?.lineUrl ?? '',
    xUrl: p?.xUrl ?? '',
    websiteUrl: p?.websiteUrl ?? '',
    homepageEnabled: p?.homepageEnabled ?? false,
    showMenu: p?.showMenu ?? true,
    showStaff: p?.showStaff ?? true,
    showGallery: p?.showGallery ?? true,
    showAddress: p?.showAddress ?? true,
    seoTitle: p?.seoTitle ?? '',
    seoDescription: p?.seoDescription ?? '',
    heroImageKey: p?.heroImageKey ?? '',
    logoImageKey: p?.logoImageKey ?? '',
    gallery: toGallery(p?.gallery),
  };
  return {
    shop: {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      description: shop.description,
      status: shop.status,
      publicBookingEnabled: shop.publicBookingEnabled,
    },
    data,
  };
}

export async function saveHomepage(tenantId: string, shopId: string, input: ShopHomepageInput) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!shop) throw Errors.notFound('店舗が見つかりません。');

  // 旧画像キーを控えておき、保存後に参照が外れたファイルを削除（ディスクの孤児化防止）
  const prev = await prisma.shopProfile.findUnique({
    where: { shopId },
    select: { heroImageKey: true, logoImageKey: true, gallery: true },
  });

  const norm = (s?: string) => (s && s.trim() !== '' ? s.trim() : null);
  const values = {
    tagline: norm(input.tagline),
    about: norm(input.about),
    businessType: input.businessType,
    accessNote: norm(input.accessNote),
    themeColor: norm(input.themeColor),
    instagramUrl: norm(input.instagramUrl),
    lineUrl: norm(input.lineUrl),
    xUrl: norm(input.xUrl),
    websiteUrl: norm(input.websiteUrl),
    homepageEnabled: input.homepageEnabled,
    showMenu: input.showMenu,
    showStaff: input.showStaff,
    showGallery: input.showGallery,
    showAddress: input.showAddress,
    seoTitle: norm(input.seoTitle),
    seoDescription: norm(input.seoDescription),
    heroImageKey: norm(input.heroImageKey),
    logoImageKey: norm(input.logoImageKey),
    gallery: input.gallery ?? [],
  };
  const saved = await prisma.shopProfile.upsert({
    where: { shopId },
    create: { shopId, tenantId, ...values },
    update: values,
  });

  // 参照が外れた旧画像をベストエフォート削除（失敗しても保存は成功扱い）
  if (prev) {
    const keep = new Set([values.heroImageKey, values.logoImageKey, ...values.gallery].filter(Boolean) as string[]);
    const old = [prev.heroImageKey, prev.logoImageKey, ...toGallery(prev.gallery)].filter(Boolean) as string[];
    await Promise.all(old.filter((k) => !keep.has(k)).map((k) => deleteImage(k)));
  }
  return saved;
}

export interface PublicHomepageHour {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}
export interface PublicHomepageService {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  priceJpy: number;
  salePriceJpy: number | null;
}
export interface PublicHomepageStaff {
  id: string;
  name: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
}
export interface PublicHomepage {
  shopId: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  /** 予約ページ（/book/{slug}）を出せるか */
  bookingEnabled: boolean;
  profile: {
    tagline: string | null;
    about: string | null;
    businessType: string;
    heroImageKey: string | null;
    logoImageKey: string | null;
    gallery: string[];
    accessNote: string | null;
    themeColor: string | null;
    instagramUrl: string | null;
    lineUrl: string | null;
    xUrl: string | null;
    websiteUrl: string | null;
    showMenu: boolean;
    showStaff: boolean;
    showGallery: boolean;
    showAddress: boolean;
    seoTitle: string | null;
    seoDescription: string | null;
  };
  hours: PublicHomepageHour[];
  services: PublicHomepageService[];
  staff: PublicHomepageStaff[];
}

/**
 * 公開ホームページを slug から解決。公開（PUBLISHED）かつ homepageEnabled のみ。
 * それ以外は null（呼び出し側で 404）。
 */
export async function getPublicHomepage(slug: string): Promise<PublicHomepage | null> {
  const shop = await prisma.shop.findFirst({
    where: { slug, status: 'PUBLISHED', deletedAt: null, profile: { homepageEnabled: true } },
    select: {
      id: true,
      tenantId: true,
      slug: true,
      name: true,
      description: true,
      phone: true,
      postalCode: true,
      prefecture: true,
      city: true,
      address: true,
      publicBookingEnabled: true,
      profile: true,
    },
  });
  if (!shop || !shop.profile) return null;
  const p = shop.profile;
  // 住所非公開時はサーバー側で落とす（HTML/JSON-LD/OG のどこにも漏れない）
  const showAddress = p.showAddress;

  const [hours, services, staff] = await Promise.all([
    prisma.businessHours.findMany({
      where: { shopId: shop.id },
      orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }],
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    p.showMenu
      ? prisma.service.findMany({
          where: { shopId: shop.id, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            category: true,
            durationMin: true,
            priceJpy: true,
            salePriceJpy: true,
          },
        })
      : Promise.resolve([]),
    p.showStaff
      ? prisma.staff.findMany({
          where: { shopId: shop.id, status: 'ACTIVE', isBookable: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, displayName: true, bio: true, avatarUrl: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    shopId: shop.id,
    tenantId: shop.tenantId,
    slug: shop.slug,
    name: shop.name,
    description: shop.description,
    phone: shop.phone,
    postalCode: showAddress ? shop.postalCode : null,
    prefecture: showAddress ? shop.prefecture : null,
    city: showAddress ? shop.city : null,
    address: showAddress ? shop.address : null,
    bookingEnabled: shop.publicBookingEnabled,
    profile: {
      tagline: p.tagline,
      about: p.about,
      businessType: p.businessType,
      heroImageKey: p.heroImageKey,
      logoImageKey: p.logoImageKey,
      gallery: toGallery(p.gallery),
      accessNote: p.accessNote,
      themeColor: p.themeColor,
      instagramUrl: p.instagramUrl,
      lineUrl: p.lineUrl,
      xUrl: p.xUrl,
      websiteUrl: p.websiteUrl,
      showMenu: p.showMenu,
      showStaff: p.showStaff,
      showGallery: p.showGallery,
      showAddress,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
    },
    hours,
    services,
    staff,
  };
}

/** サイトマップ用: 公開中ホームページの slug と更新時刻。 */
export async function listPublishedHomepageSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const shops = await prisma.shop.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, profile: { homepageEnabled: true } },
    select: { slug: true, updatedAt: true, profile: { select: { updatedAt: true } } },
  });
  return shops.map((s) => ({
    slug: s.slug,
    updatedAt: s.profile && s.profile.updatedAt > s.updatedAt ? s.profile.updatedAt : s.updatedAt,
  }));
}
