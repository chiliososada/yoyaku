import { CreditCard } from 'lucide-react';
import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { nowUtc } from '@/lib/time';
import { isStripeConfigured } from '@/server/billing/stripe';
import { evaluateBillingAccess } from '@/server/billing/billing-service';
import { getBookingQuotaUsage } from '@/server/services/billing-quota-service';
import { PageHeader, Panel } from '@/components/admin/ui';
import { BillingPanel } from '@/components/admin/billing-panel';

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams: { checkout?: string };
}) {
  // 課金ゲートは適用しない（ロック時の着地ページ自身のため）
  const user = await requireTenantUser({ skipBillingGate: true });
  const canManage = hasPermission(user, PERMISSIONS.SHOP_CREATE);

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: user.tenantId },
    select: {
      name: true,
      billingExempt: true,
      stripeCustomerId: true,
      stripeSubscriptionStatus: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      plan: { select: { name: true, priceJpy: true } },
    },
  });
  const gate = evaluateBillingAccess(tenant, { now: nowUtc(), stripeConfigured: isStripeConfigured() });

  const quota = await getBookingQuotaUsage(user.tenantId);

  const plans = await prisma.plan.findMany({
    where: { isActive: true, stripePriceId: { not: null } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, description: true, priceJpy: true, maxShops: true, maxStaffPerShop: true },
  });

  return (
    <div>
      <PageHeader
        title="契約・お支払い"
        description="プランのご契約状況とお支払い方法の管理"
      />
      <Panel>
        <BillingPanel
          state={gate.state}
          trialDaysLeft={gate.trialDaysLeft}
          accessUntil={gate.accessUntil?.toISOString() ?? null}
          canManage={canManage}
          hasPaymentAccount={Boolean(tenant.stripeCustomerId)}
          subscriptionStatus={tenant.stripeSubscriptionStatus}
          currentPeriodEnd={tenant.currentPeriodEnd?.toISOString() ?? null}
          planName={tenant.plan?.name ?? null}
          planPriceJpy={tenant.plan?.priceJpy ?? null}
          plans={plans}
          checkoutResult={searchParams.checkout ?? null}
          quota={{ used: quota.used, limit: quota.limit, planName: quota.planName }}
        />
      </Panel>
      {!canManage && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <CreditCard className="size-3.5" /> ご契約の変更はオーナー権限のアカウントで行えます。
        </p>
      )}
      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        お申し込みにあたっては
        <a href="/legal/terms" target="_blank" className="mx-1 underline hover:text-foreground">利用規約</a>・
        <a href="/legal/tokushoho" target="_blank" className="mx-1 underline hover:text-foreground">特定商取引法に基づく表記</a>
        をご確認ください。
      </p>
    </div>
  );
}
