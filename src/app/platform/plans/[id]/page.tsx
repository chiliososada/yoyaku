import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { getPlanForEdit } from '@/server/services/platform-service';
import { PageHeader } from '@/components/admin/ui';
import { PlanForm } from '@/components/admin/plan-form';

export const dynamic = 'force-dynamic';

export default async function EditPlanPage({ params }: { params: { id: string } }) {
  await requirePlatformAdmin();
  const plan = await getPlanForEdit(params.id);
  if (!plan) notFound();

  return (
    <div>
      <Link href="/platform/plans" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> プラン一覧へ
      </Link>
      <PageHeader title="プラン編集" description={`${plan.name}（${plan.code}）`} />
      <PlanForm
        planId={plan.id}
        initial={{
          name: plan.name,
          priceJpy: plan.priceJpy,
          maxShops: plan.maxShops,
          maxStaffPerShop: plan.maxStaffPerShop,
          maxBookingsPerMonth: plan.maxBookingsPerMonth,
          stripePriceId: plan.stripePriceId ?? '',
          isActive: plan.isActive,
        }}
      />
    </div>
  );
}
