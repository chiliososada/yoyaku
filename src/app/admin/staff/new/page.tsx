import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getServiceOptions } from '@/server/services/merchant-service';
import { PageHeader } from '@/components/admin/ui';
import { StaffForm } from '@/components/admin/staff-form';

export const dynamic = 'force-dynamic';

export default async function NewStaffPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const services = await getServiceOptions(user.tenantId, shop.id);

  return (
    <div>
      <Link href="/admin/staff" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> スタッフ一覧へ
      </Link>
      <PageHeader title="スタッフ登録" description="新しいスタッフを登録します" />
      <StaffForm shopId={shop.id} services={services} />
    </div>
  );
}
