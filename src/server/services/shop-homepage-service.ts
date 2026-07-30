/**
 * 店舗の「専属ホームページ」（SEO公開ページ）向けサービス。
 * - 編集用: getHomepageForEditor / saveHomepage（ShopProfile を upsert）
 * - 公開用: getPublicHomepage（公開かつ homepageEnabled のみ。店舗情報＋メニュー＋スタッフ＋営業時間）
 * - サイトマップ用: listPublishedHomepageSlugs
 */
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { jpHolidaysInRange } from '@/lib/jp-holidays';
import { todayInZone } from '@/lib/time';
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
/** 直近の臨時休業・特別営業（ホームページの「お知らせ」と JSON-LD に使う）。 */
export interface PublicHomepageSpecialDay {
  /** YYYY-MM-DD */
  date: string;
  type: 'CLOSED' | 'SPECIAL_OPEN' | 'MODIFIED_HOURS';
  openMinute: number | null;
  closeMinute: number | null;
  reason: string | null;
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
  /** 祝日を休業にする設定。営業時間表と JSON-LD の双方に反映する。 */
  closeOnNationalHolidays: boolean;
  /** 今日から60日先までの臨時休業・特別営業（日付昇順） */
  specialDays: PublicHomepageSpecialDay[];
  /** 今日から60日先までの祝日（祝日休業の店で「この日は休み」を出すため） */
  upcomingHolidays: { date: string; name: string }[];
  services: PublicHomepageService[];
  staff: PublicHomepageStaff[];
  /** 管理画面からの下書きプレビューか（公開ページでは false） */
  preview?: boolean;
}

/** お知らせに出す先読み日数。長すぎると「まだ先の話」が並んで邪魔になる。 */
const NOTICE_DAYS = 60;

const SHOP_SELECT = {
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
  timezone: true,
  publicBookingEnabled: true,
  closeOnNationalHolidays: true,
  profile: true,
} as const;

/**
 * 公開ホームページを slug から解決。公開（PUBLISHED）かつ homepageEnabled のみ。
 * それ以外は null（呼び出し側で 404）。
 */
export async function getPublicHomepage(slug: string): Promise<PublicHomepage | null> {
  const shop = await prisma.shop.findFirst({
    where: { slug, status: 'PUBLISHED', deletedAt: null, profile: { homepageEnabled: true } },
    select: SHOP_SELECT,
  });
  if (!shop || !shop.profile) return null;
  return buildHomepage(shop, false);
}

/**
 * 管理画面からの下書きプレビュー。**公開状態を問わず**同じ見た目で描画する。
 *
 * 「プレビュー」が未公開だと 404 になっていたため、店主は自分のページを一度も見ないまま
 * 公開ボタンを押すしかなかった（しかも404の理由がどこにも書かれていない）。
 * ここはテナント内から shopId で引くので、他店の下書きは覗けない。
 */
export async function getHomepagePreview(
  tenantId: string,
  shopId: string,
): Promise<PublicHomepage | null> {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, tenantId, deletedAt: null },
    select: SHOP_SELECT,
  });
  if (!shop) return null;
  return buildHomepage(shop, true);
}

type ProfileFields = PublicHomepage['profile'];
type ShopRow = {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string | null;
  phone: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  timezone: string;
  publicBookingEnabled: boolean;
  closeOnNationalHolidays: boolean;
  /** gallery は Prisma の Json 列なので unknown で受け、toGallery で正規化する */
  profile: (Omit<ProfileFields, 'gallery'> & { gallery: unknown }) | null;
};

/** プレビューではプロフィール未作成でも描画できるよう既定値で埋める */
const EMPTY_PROFILE: ProfileFields & { gallery: string[] } = {
  tagline: null,
  about: null,
  businessType: 'HealthAndBeautyBusiness',
  heroImageKey: null,
  logoImageKey: null,
  gallery: [],
  accessNote: null,
  themeColor: null,
  instagramUrl: null,
  lineUrl: null,
  xUrl: null,
  websiteUrl: null,
  showMenu: true,
  showStaff: true,
  showGallery: true,
  showAddress: true,
  seoTitle: null,
  seoDescription: null,
};

async function buildHomepage(shop: ShopRow, preview: boolean): Promise<PublicHomepage> {
  const p = shop.profile ?? EMPTY_PROFILE;
  // 住所非公開時はサーバー側で落とす（HTML/JSON-LD/OG のどこにも漏れない）
  const showAddress = p.showAddress;

  // 今日〜60日先の臨時休業/特別営業と祝日。営業時間表だけを見て来店した客が
  // 閉まった店の前に立つ——を防ぐため、ホームページ側にも必ず出す。
  const today = todayInZone(shop.timezone);
  const until = new Date(new Date(`${today}T00:00:00Z`).getTime() + NOTICE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [hours, specials, services, staff] = await Promise.all([
    prisma.businessHours.findMany({
      where: { shopId: shop.id },
      orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }],
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    prisma.specialBusinessDay.findMany({
      where: {
        shopId: shop.id,
        date: { gte: new Date(`${today}T00:00:00.000Z`), lt: new Date(`${until}T00:00:00.000Z`) },
      },
      orderBy: { date: 'asc' },
      select: { date: true, type: true, openMinute: true, closeMinute: true, reason: true },
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
    closeOnNationalHolidays: shop.closeOnNationalHolidays,
    specialDays: specials.map((sp) => ({
      date: sp.date.toISOString().slice(0, 10),
      type: sp.type as PublicHomepageSpecialDay['type'],
      openMinute: sp.openMinute,
      closeMinute: sp.closeMinute,
      reason: sp.reason,
    })),
    upcomingHolidays: shop.closeOnNationalHolidays ? jpHolidaysInRange(today, until) : [],
    services,
    staff,
    ...(preview ? { preview: true } : {}),
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
