import Link from 'next/link';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { listPlans } from '@/server/services/platform-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { formatJpy } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function PlansPage() {
  await requirePlatformAdmin();
  const plans = await listPlans();

  return (
    <div>
      <PageHeader title="プラン管理" description="料金プランの一覧" />
      {plans.length === 0 ? (
        <EmptyState message="プランが登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>プラン</Th>
              <Th>コード</Th>
              <Th className="text-right">月額</Th>
              <Th className="text-right">店舗上限</Th>
              <Th className="text-right">スタッフ/店舗</Th>
              <Th className="text-right">予約/月</Th>
              <Th className="text-right">契約数</Th>
              <Th>状態</Th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td className="font-medium">
                  <Link href={`/platform/plans/${p.id}`} className="text-primary hover:underline">{p.name}</Link>
                </Td>
                <Td className="text-muted-foreground"><code className="text-xs">{p.code}</code></Td>
                <Td className="text-right tabular-nums">{formatJpy(p.priceJpy)}</Td>
                <Td className="text-right tabular-nums">{p.maxShops}</Td>
                <Td className="text-right tabular-nums">{p.maxStaffPerShop}</Td>
                <Td className="text-right tabular-nums">{p.maxBookingsPerMonth.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{p._count.tenants}</Td>
                <Td>
                  <StatusPill status={p.isActive ? 'ACTIVE' : 'INACTIVE'} label={p.isActive ? '有効' : '無効'} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
