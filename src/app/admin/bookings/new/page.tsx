import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { prisma } from '@/lib/db';
import { PageHeader } from '@/components/admin/ui';
import { AdminBookingForm } from '@/components/admin/admin-booking-form';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);

  const [services, staff] = await Promise.all([
    prisma.service.findMany({
      where: { shopId: shop.id, tenantId: user.tenantId, deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, requiresStaff: true, serviceStaff: { select: { staffId: true } } },
    }),
    prisma.staff.findMany({
      where: { shopId: shop.id, tenantId: user.tenantId, deletedAt: null, status: 'ACTIVE' },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div>
      <Link href="/admin/bookings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 予約一覧へ
      </Link>
      <PageHeader title="代理予約の登録" description="電話・来店時の予約を管理者が登録します（空き枠はサーバーで再判定）" />
      <AdminBookingForm
        shopId={shop.id}
        timezone={shop.timezone}
        services={services.map((s) => ({ id: s.id, name: s.name, requiresStaff: s.requiresStaff, staffIds: s.serviceStaff.map((x) => x.staffId) }))}
        staff={staff}
      />
    </div>
  );
}
