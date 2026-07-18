import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getStaffOptions } from '@/server/services/merchant-service';
import { PageHeader } from '@/components/admin/ui';
import { ServiceForm } from '@/components/admin/service-form';

export const dynamic = 'force-dynamic';

export default async function NewServicePage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const staff = await getStaffOptions(user.tenantId, shop.id);

  return (
    <div>
      <Link href="/admin/services" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> メニュー一覧へ
      </Link>
      <PageHeader title="メニュー登録" description="新しいサービスメニューを登録します" />
      <ServiceForm shopId={shop.id} staff={staff} />
    </div>
  );
}
