import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { getPrimaryShop, getDormantCustomers } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { formatShortJa, nowUtc } from '@/lib/time';
import { formatJpy, cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const OPTIONS = [60, 90, 180];

export default async function DormantCustomersPage({ searchParams }: { searchParams: { days?: string } }) {
  const user = await requireTenantUser();
  if (!hasPermission(user, PERMISSIONS.ANALYTICS_READ)) notFound();
  const shop = await getPrimaryShop(user.tenantId);
  const days = OPTIONS.includes(Number(searchParams.days)) ? Number(searchParams.days) : 90;
  const list = await getDormantCustomers(user.tenantId, shop.id, days);
  const now = nowUtc().getTime();

  return (
    <div>
      <Link href="/admin/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 顧客一覧へ
      </Link>
      <PageHeader
        title="休眠顧客"
        description={`最終来店から ${days} 日以上・今後の予約なし（${list.length} 名）`}
        action={
          <div className="flex gap-1 rounded-lg border bg-white p-1">
            {OPTIONS.map((d) => (
              <Link
                key={d}
                href={`/admin/customers/dormant?days=${d}`}
                className={cn(
                  'rounded-md px-3 py-1 text-sm',
                  d === days ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-slate-100',
                )}
              >
                {d}日
              </Link>
            ))}
          </div>
        }
      />

      {list.length === 0 ? (
        <EmptyState message="該当する休眠顧客はいません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>顧客</Th>
              <Th>連絡先</Th>
              <Th className="text-right">来店回数</Th>
              <Th className="text-right">累計利用額</Th>
              <Th className="text-right">最終来店</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const daysSince = Math.floor((now - c.lastVisit.getTime()) / 86_400_000);
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/admin/customers/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                    {c.nameKana && <div className="text-xs text-muted-foreground">{c.nameKana}</div>}
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {c.phone && <div className="tabular-nums">{c.phone}</div>}
                    {c.email && <div>{c.email}</div>}
                    {!c.phone && !c.email && '—'}
                  </Td>
                  <Td className="text-right tabular-nums">{c.visitCount}</Td>
                  <Td className="text-right tabular-nums">{formatJpy(c.totalSpent)}</Td>
                  <Td className="text-right">
                    <div className="tabular-nums">{formatShortJa(c.lastVisit, 'Asia/Tokyo')}</div>
                    <div className="text-xs text-muted-foreground">{daysSince}日前</div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        ※ 連絡先へDM・電話で再来を促すのに活用できます。今後の予約が入っている顧客は自動的に除外しています。
      </p>
    </div>
  );
}
