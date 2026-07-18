import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, canAccessShop } from '@/server/auth/authorize';
import { getPrimaryShop, getServiceOptions, getStaffForEdit } from '@/server/services/merchant-service';
import { isAppError } from '@/lib/errors';
import { PageHeader, Panel } from '@/components/admin/ui';
import { StaffForm } from '@/components/admin/staff-form';
import { StaffLoginForm } from '@/components/admin/staff-login-form';
import { DeleteStaffButton } from '@/components/admin/delete-buttons';

export const dynamic = 'force-dynamic';

export default async function EditStaffPage({ params }: { params: { id: string } }) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  let staff;
  try {
    staff = await getStaffForEdit(user.tenantId, params.id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  // 店舗スコープ外（別店舗のスタッフ）は 404。スコープ付き店長の店舗越境な閲覧を防止。
  if (!canAccessShop(user, staff.shopId)) notFound();
  const services = await getServiceOptions(user.tenantId, shop.id);

  return (
    <div>
      <Link href="/admin/staff" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> スタッフ一覧へ
      </Link>
      <PageHeader
        title="スタッフ編集"
        description={staff.name}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/admin/staff/${staff.id}/schedule`} className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50">
              シフト設定
            </Link>
            <DeleteStaffButton staffId={staff.id} shopId={shop.id} />
          </div>
        }
      />
      <StaffForm
        shopId={shop.id}
        services={services}
        staffId={staff.id}
        initial={{
          name: staff.name,
          displayName: staff.displayName ?? '',
          email: staff.email ?? '',
          phone: staff.phone ?? '',
          bio: staff.bio ?? '',
          isBookable: staff.isBookable,
          capacity: staff.capacity,
          nominationFeeJpy: staff.nominationFeeJpy,
          status: staff.status,
          sortOrder: staff.sortOrder,
          serviceIds: staff.serviceIds,
        }}
      />

      <div className="mt-6">
        <Panel title="スタッフのログイン">
          <StaffLoginForm
            staffId={staff.id}
            shopId={shop.id}
            defaultEmail={staff.email ?? ''}
            login={staff.login}
          />
        </Panel>
      </div>
    </div>
  );
}
