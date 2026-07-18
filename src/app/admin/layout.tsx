import { requireTenantUser } from '@/server/auth/authorize';
import { prisma } from '@/lib/db';
import { getTenantShops, getPrimaryShop } from '@/server/services/merchant-service';
import { AdminShell } from '@/components/admin/admin-shell';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // 課金ゲートはここでは適用しない: /admin/billing もこのレイアウト配下にあり、
  // レイアウトで redirect すると着地ページ自身に到達できず無限リダイレクトになる。
  // ゲートは各ページの requireTenantUser()（billing ページのみ skip）で強制される。
  const user = await requireTenantUser({ skipBillingGate: true });
  const [tenant, allShops, currentShop] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } }),
    getTenantShops(user.tenantId),
    getPrimaryShop(user.tenantId).catch(() => null),
  ]);

  // スタッフ（テナント全体権限なし）は自分のスコープ店舗のみ切り替え可能。
  const visibleShops =
    user.tenantWide || user.isPlatformAdmin
      ? allShops
      : allShops.filter((s) => user.shopScopes.includes(s.id));

  return (
    <AdminShell
      variant="merchant"
      brandLabel={tenant?.name ?? '商家管理'}
      userName={user.name ?? 'ユーザー'}
      userEmail={user.email ?? ''}
      permissions={user.permissions}
      shops={visibleShops.map((s) => ({ id: s.id, name: s.name, status: s.status }))}
      currentShopId={currentShop?.id}
    >
      {children}
    </AdminShell>
  );
}
