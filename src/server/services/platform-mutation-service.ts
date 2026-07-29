/**
 * プラットフォーム後台の書込サービス（プラットフォーム管理者専用）。
 */
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { nowUtc } from '@/lib/time';
import type { CreateTenantInput, PlanFormInput } from '@/lib/validation/platform';
import { BILLING_TRIAL_DAYS } from '@/server/billing/billing-service';

/**
 * 商家を新規作成（テナント + 初期店舗 + オーナーユーザー + 既定設定）。
 * 公開予約URLの一意性のため shopSlug はグローバルに重複チェックする。
 */
export async function createTenant(input: CreateTenantInput) {
  const [tenantTaken, shopTaken, emailTaken] = await Promise.all([
    prisma.tenant.findUnique({ where: { slug: input.tenantSlug }, select: { id: true } }),
    prisma.shop.findFirst({ where: { slug: input.shopSlug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.ownerEmail }, select: { id: true } }),
  ]);
  if (tenantTaken) throw Errors.conflict('CONFLICT', '商家slugは既に使用されています。');
  if (shopTaken) throw Errors.conflict('CONFLICT', '店舗slugは既に使用されています。');
  if (emailTaken) throw Errors.conflict('CONFLICT', 'このメールアドレスは既に登録されています。');

  const plan = input.planCode
    ? await prisma.plan.findUnique({ where: { code: input.planCode }, select: { id: true } })
    : null;
  const ownerRole = await prisma.role.findFirst({ where: { code: 'TENANT_OWNER', tenantId: null }, select: { id: true } });
  if (!ownerRole) throw Errors.internal(new Error('TENANT_OWNER role missing (run seed)'));

  const passwordHash = bcrypt.hashSync(input.ownerPassword, 10);

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug: input.tenantSlug,
        name: input.tenantName,
        status: 'ACTIVE',
        planId: plan?.id ?? null,
        // 新規商家は 30 日の無料トライアル付き。期限後は契約（Stripe）が無いと後台がロックされる
        trialEndsAt: new Date(nowUtc().getTime() + BILLING_TRIAL_DAYS * 86_400_000),
      },
    });
    const shop = await tx.shop.create({
      data: {
        tenantId: tenant.id,
        slug: input.shopSlug,
        name: input.shopName,
        timezone: 'Asia/Tokyo',
        status: 'DRAFT',
        publicBookingEnabled: false,
        closeOnNationalHolidays: true,
        settings: { shopCapacity: 1 },
      },
    });
    // 既定の営業時間（月〜土 10:00-19:00）
    await tx.businessHours.createMany({
      data: [1, 2, 3, 4, 5, 6].map((dow) => ({ tenantId: tenant.id, shopId: shop.id, dayOfWeek: dow, openMinute: 600, closeMinute: 1140 })),
    });
    // 既定の容量ルール
    await tx.bookingCapacityRule.create({
      data: { tenantId: tenant.id, shopId: shop.id, scope: 'SHOP', maxConcurrent: 1, slotIntervalMin: 30, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24 },
    });
    // オーナーユーザー + メンバーシップ
    const owner = await tx.user.create({
      data: { email: input.ownerEmail, name: input.ownerName, passwordHash, tenantId: tenant.id, status: 'ACTIVE' },
    });
    await tx.membership.create({ data: { userId: owner.id, roleId: ownerRole.id } });

    return { tenantId: tenant.id, shopId: shop.id, ownerId: owner.id, planId: plan?.id ?? null };
  }).then(async (created) => {
    // トライアル開始を課金台帳へ（コホート分析の起点。台帳書込は best-effort でテナント作成を妨げない）
    const { recordTrialStarted } = await import('@/server/billing/billing-service');
    await recordTrialStarted(created.tenantId, created.planId, nowUtc());
    return { tenantId: created.tenantId, shopId: created.shopId, ownerId: created.ownerId };
  }).catch((e: unknown) => {
    // 事前チェックと create の間の競合（slug/email 一意制約）→ 友好的な CONFLICT に変換
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw Errors.conflict('CONFLICT', 'slug またはメールアドレスが直前に他で使用されました。別の値でお試しください。');
    }
    throw e;
  });
}

/** ユーザーの状態変更（有効化/停止）。プラットフォーム管理者は対象外。 */
export async function setUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, isPlatformAdmin: true } });
  if (!user) throw Errors.notFound('ユーザーが見つかりません。');
  if (user.isPlatformAdmin) throw Errors.forbidden('プラットフォーム管理者の状態は変更できません。');
  // 停止時は sessionEpoch を進めて既存 JWT を即時失効（停止後も最大7日使えてしまう穴を塞ぐ）。
  await prisma.user.update({
    where: { id: userId },
    data: status === 'SUSPENDED' ? { status, sessionEpoch: { increment: 1 } } : { status },
  });
}

/** プラン編集。 */
export async function updatePlan(planId: string, input: PlanFormInput) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) throw Errors.notFound('プランが見つかりません。');
  await prisma.plan.update({
    where: { id: planId },
    data: {
      name: input.name,
      priceJpy: input.priceJpy,
      maxShops: input.maxShops,
      maxStaffPerShop: input.maxStaffPerShop,
      maxBookingsPerMonth: input.maxBookingsPerMonth,
      stripePriceId: input.stripePriceId || null,
      isActive: input.isActive,
      updatedAt: nowUtc(),
    },
  });
}
