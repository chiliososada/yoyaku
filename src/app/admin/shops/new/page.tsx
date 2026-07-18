import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { PageHeader, Panel } from '@/components/admin/ui';
import { ShopForm } from '@/components/admin/shop-form';

export const dynamic = 'force-dynamic';

export default async function NewShopPage() {
  await requireTenantUser();
  return (
    <div className="mx-auto max-w-lg">
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> ダッシュボードへ
      </Link>
      <PageHeader title="店舗を追加" description="新しい店舗を作成します（作成後この店舗に切り替わります）" />
      <Panel title="新規店舗">
        <ShopForm />
      </Panel>
    </div>
  );
}
