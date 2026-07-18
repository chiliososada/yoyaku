import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { listTenants } from '@/server/services/platform-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { formatShortJa } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TENANT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '有効',
  TRIAL: 'トライアル',
  SUSPENDED: '停止',
  CANCELLED: '解約',
};

export default async function TenantsPage() {
  await requirePlatformAdmin();
  const tenants = await listTenants();

  return (
    <div>
      <PageHeader
        title="商家管理"
        description={`${tenants.length} 社の商家`}
        action={
          <Link href="/platform/tenants/new" className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" /> 新規商家
          </Link>
        }
      />
      {tenants.length === 0 ? (
        <EmptyState message="商家が登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>商家名</Th>
              <Th>slug</Th>
              <Th>プラン</Th>
              <Th className="text-right">店舗</Th>
              <Th className="text-right">ユーザー</Th>
              <Th>状態</Th>
              <Th>登録日</Th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <Td className="font-medium">
                  <Link href={`/platform/tenants/${t.id}`} className="text-primary hover:underline">{t.name}</Link>
                </Td>
                <Td className="text-muted-foreground"><code className="text-xs">{t.slug}</code></Td>
                <Td>{t.plan?.name ?? '—'}</Td>
                <Td className="text-right tabular-nums">{t._count.shops}</Td>
                <Td className="text-right tabular-nums">{t._count.users}</Td>
                <Td>
                  <StatusPill status={t.status === 'ACTIVE' ? 'ACTIVE' : t.status === 'SUSPENDED' ? 'CANCELLED' : 'DRAFT'} label={TENANT_STATUS_LABEL[t.status] ?? t.status} />
                </Td>
                <Td className="text-muted-foreground">{formatShortJa(t.createdAt, 'Asia/Tokyo')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
