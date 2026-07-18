import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { listPlans } from '@/server/services/platform-service';
import { PageHeader } from '@/components/admin/ui';
import { CreateTenantForm } from '@/components/admin/create-tenant-form';

export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  await requirePlatformAdmin();
  const plans = await listPlans();

  return (
    <div>
      <Link href="/platform/tenants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 商家一覧へ
      </Link>
      <PageHeader title="商家の新規作成" description="テナント・初期店舗・オーナーアカウントを作成します" />
      <CreateTenantForm plans={plans.filter((p) => p.isActive).map((p) => ({ code: p.code, name: p.name }))} />
    </div>
  );
}
