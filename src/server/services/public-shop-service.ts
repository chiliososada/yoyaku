/**
 * 公開予約ページ向けサービス。認証不要で、公開可能な店舗情報のみ返す。
 */
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';

export interface PublicStaff {
  id: string;
  name: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** 指名料（円）。0 なら無料指名 */
  nominationFeeJpy: number;
}

export interface PublicServiceOption {
  id: string;
  name: string;
  priceJpy: number;
  extraDurationMin: number;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  durationMin: number;
  priceJpy: number;
  /** セール価格（円）。null=セールなし。設定時は priceJpy を取り消し線表示する。 */
  salePriceJpy: number | null;
  color: string | null;
  requiresStaff: boolean;
  bufferAfterMin: number;
  /** このサービスを担当できるスタッフID */
  staffIds: string[];
  /** 追加オプション */
  options: PublicServiceOption[];
}

export interface PublicShop {
  tenantId: string;
  id: string;
  slug: string;
  name: string;
  description: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  timezone: string;
  services: PublicService[];
  staff: PublicStaff[];
}

/** slug から公開店舗を解決。非公開/削除済みは 404。 */
export async function getPublicShop(slug: string): Promise<PublicShop> {
  const shop = await prisma.shop.findFirst({
    where: { slug, status: 'PUBLISHED', publicBookingEnabled: true, deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      slug: true,
      name: true,
      description: true,
      prefecture: true,
      city: true,
      address: true,
      phone: true,
      timezone: true,
      // ホームページの「住所を表示する」設定は予約ページ・公開APIにも効かせる。
      // ここを見ないと、自宅サロンの店主が住所を隠したつもりでも
      // /book/{slug} と公開APIから番地まで見え続ける（本人は気づけない）。
      profile: { select: { showAddress: true } },
    },
  });
  if (!shop) throw Errors.notFound('店舗が見つかりませんでした。');

  // プロフィール未作成時は既定で表示（従来挙動）。明示的に false のときだけ伏せる。
  const hideAddress = shop.profile?.showAddress === false;

  const [services, staff] = await Promise.all([
    prisma.service.findMany({
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
        color: true,
        requiresStaff: true,
        bufferAfterMin: true,
        serviceStaff: {
          where: { staff: { status: 'ACTIVE', isBookable: true, deletedAt: null } },
          select: { staffId: true },
        },
        options: {
          where: { isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, priceJpy: true, extraDurationMin: true },
        },
      },
    }),
    prisma.staff.findMany({
      where: { shopId: shop.id, status: 'ACTIVE', isBookable: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, displayName: true, bio: true, avatarUrl: true, nominationFeeJpy: true },
    }),
  ]);

  const { profile: _profile, ...shopFields } = shop;
  return {
    ...shopFields,
    // 住所を伏せる設定なら、市区町村より細かい情報を公開面から落とす
    // （都道府県までは検索性のため残す。ホームページ側の表示方針と揃える）
    city: hideAddress ? null : shopFields.city,
    address: hideAddress ? null : shopFields.address,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      durationMin: s.durationMin,
      priceJpy: s.priceJpy,
      salePriceJpy: s.salePriceJpy,
      color: s.color,
      requiresStaff: s.requiresStaff,
      bufferAfterMin: s.bufferAfterMin,
      staffIds: s.serviceStaff.map((ss) => ss.staffId),
      options: s.options,
    })),
    staff,
  };
}

/** slug → { tenantId, shopId }（書込系の入口で使用）。 */
export async function resolveShopIds(slug: string): Promise<{ tenantId: string; shopId: string }> {
  const shop = await prisma.shop.findFirst({
    where: { slug, status: 'PUBLISHED', publicBookingEnabled: true, deletedAt: null },
    select: { id: true, tenantId: true },
  });
  if (!shop) throw Errors.notFound('店舗が見つかりませんでした。');
  return { tenantId: shop.tenantId, shopId: shop.id };
}
