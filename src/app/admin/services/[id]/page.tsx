import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, canAccessShop } from '@/server/auth/authorize';
import { getPrimaryShop, getStaffOptions, getServiceForEdit } from '@/server/services/merchant-service';
import { isAppError } from '@/lib/errors';
import { PageHeader } from '@/components/admin/ui';
import { ServiceForm } from '@/components/admin/service-form';
import { DeleteServiceButton } from '@/components/admin/delete-buttons';

export const dynamic = 'force-dynamic';

function parseSegments(raw: unknown): { offsetMin: number; durationMin: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const o = s as Record<string, unknown>;
      return { offsetMin: Number(o.offsetMin), durationMin: Number(o.durationMin) };
    })
    .filter((s) => Number.isFinite(s.offsetMin) && Number.isFinite(s.durationMin));
}

export default async function EditServicePage({ params }: { params: { id: string } }) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  let service;
  try {
    service = await getServiceForEdit(user.tenantId, params.id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  // 店舗スコープ外（別店舗のメニュー）は 404。
  if (!canAccessShop(user, service.shopId)) notFound();
  const staff = await getStaffOptions(user.tenantId, shop.id);

  return (
    <div>
      <Link href="/admin/services" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> メニュー一覧へ
      </Link>
      <PageHeader title="メニュー編集" description={service.name} action={<DeleteServiceButton serviceId={service.id} shopId={shop.id} />} />
      <ServiceForm
        shopId={shop.id}
        staff={staff}
        serviceId={service.id}
        initial={{
          name: service.name,
          category: service.category ?? '',
          description: service.description ?? '',
          durationMin: service.durationMin,
          bufferAfterMin: service.bufferAfterMin,
          priceJpy: service.priceJpy,
          salePriceJpy: service.salePriceJpy,
          capacity: service.capacity,
          requiresStaff: service.requiresStaff,
          slotIntervalMin: service.slotIntervalMin,
          color: service.color ?? '',
          isActive: service.isActive,
          sortOrder: service.sortOrder,
          staffIds: service.staffIds,
          segments: parseSegments(service.segments),
          options: service.options.map((o) => ({
            id: o.id,
            name: o.name,
            priceJpy: o.priceJpy,
            extraDurationMin: o.extraDurationMin,
          })),
        }}
      />
    </div>
  );
}
