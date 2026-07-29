/**
 * プラットフォーム後台の読み取りサービス。全テナント横断（プラットフォーム管理者専用）。
 */
import { prisma } from '@/lib/db';
import { nowUtc } from '@/lib/time';

export async function getPlatformStats() {
  const now = nowUtc();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  const [tenantCount, shopCount, userCount, bookingCount, recentBookings, payingTenants, canceledTenants] =
    await Promise.all([
      prisma.tenant.count({ where: { deletedAt: null } }),
      prisma.shop.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.booking.count({ where: { deletedAt: null } }),
      prisma.booking.count({ where: { createdAt: { gte: dayAgo } } }),
      // 「実際に課金されている商家」。旧実装は tenant.status='ACTIVE' を数えていたが、
      // この列は作成時に書かれたきり遷移しないため常に総数と一致し、意味を成さなかった。
      prisma.tenant.count({
        where: {
          deletedAt: null,
          billingExempt: false,
          stripeSubscriptionStatus: { in: ['active', 'trialing', 'past_due'] },
        },
      }),
      prisma.tenant.count({ where: { deletedAt: null, status: 'CANCELLED' } }),
    ]);
  return { tenantCount, shopCount, userCount, bookingCount, recentBookings, payingTenants, canceledTenants };
}

export async function listTenants() {
  return prisma.tenant.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      createdAt: true,
      plan: { select: { name: true } },
      _count: { select: { shops: true, users: true } },
    },
  });
}

export async function listPlans() {
  return prisma.plan.findMany({
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      priceJpy: true,
      maxShops: true,
      maxStaffPerShop: true,
      maxBookingsPerMonth: true,
      isActive: true,
      _count: { select: { tenants: true } },
    },
  });
}

export async function getTenantDetail(tenantId: string) {
  const tenant = await prisma.tenant.findFirst({
    where: { id: tenantId, deletedAt: null },
    select: {
      id: true, slug: true, name: true, status: true, createdAt: true,
      billingExempt: true, stripeCustomerId: true, stripeSubscriptionStatus: true,
      currentPeriodEnd: true, trialEndsAt: true,
      plan: { select: { name: true } },
      shops: {
        where: { deletedAt: null },
        select: { id: true, slug: true, name: true, status: true, publicBookingEnabled: true, _count: { select: { staff: true, services: true, bookings: true } } },
      },
      users: {
        where: { deletedAt: null },
        select: { id: true, name: true, email: true, status: true },
      },
    },
  });
  if (!tenant) return null;
  const bookingCount = await prisma.booking.count({ where: { tenantId, deletedAt: null } });
  return { ...tenant, bookingCount };
}

export async function getPlanForEdit(planId: string) {
  return prisma.plan.findUnique({
    where: { id: planId },
    select: { id: true, code: true, name: true, priceJpy: true, maxShops: true, maxStaffPerShop: true, maxBookingsPerMonth: true, stripePriceId: true, isActive: true },
  });
}

export async function listPlatformUsers(take = 100) {
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      isPlatformAdmin: true,
      lastLoginAt: true,
      tenant: { select: { name: true } },
      _count: { select: { memberships: true } },
    },
  });
}

export async function listAuditLogs(take = 100) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
      tenant: { select: { name: true } },
    },
  });
}

export async function getSystemConfigs() {
  return prisma.systemConfig.findMany({ orderBy: { key: 'asc' } });
}
