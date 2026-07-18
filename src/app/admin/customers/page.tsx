import Link from 'next/link';
import { MoonStar } from 'lucide-react';
import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { listCustomers } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { formatShortJa } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const user = await requireTenantUser();
  const customers = await listCustomers(user.tenantId);
  // 休眠顧客は分析（ANALYTICS_READ）機能。権限が無いスタッフには導線を出さない（クリックしても弾かれるため）。
  const canSeeDormant = hasPermission(user, PERMISSIONS.ANALYTICS_READ);

  return (
    <div>
      <PageHeader
        title="顧客管理"
        description={`${customers.length} 名の顧客`}
        action={
          canSeeDormant ? (
            <Link
              href="/admin/customers/dormant"
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-slate-50"
            >
              <MoonStar className="size-4" /> 休眠顧客
            </Link>
          ) : undefined
        }
      />
      {customers.length === 0 ? (
        <EmptyState message="顧客はまだ登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>お名前</Th>
              <Th>フリガナ</Th>
              <Th>メール</Th>
              <Th>電話</Th>
              <Th className="text-right">予約回数</Th>
              <Th>登録日</Th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td className="font-medium">
                  <Link href={`/admin/customers/${c.id}`} className="text-primary hover:underline">{c.name}</Link>
                </Td>
                <Td className="text-muted-foreground">{c.nameKana ?? '—'}</Td>
                <Td>{c.email ?? '—'}</Td>
                <Td>{c.phone ?? '—'}</Td>
                <Td className="text-right tabular-nums">{c._count.bookings}</Td>
                <Td className="text-muted-foreground">{formatShortJa(c.createdAt, 'Asia/Tokyo')}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
