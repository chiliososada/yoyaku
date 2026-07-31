import Link from 'next/link';
import { Plus, CalendarClock } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, listStaff } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = { ACTIVE: '稼働中', INACTIVE: '停止中' };

export default async function StaffPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const staff = await listStaff(user.tenantId, shop.id);

  return (
    <div>
      <PageHeader
        title="スタッフ管理"
        description={`${shop.name} のスタッフ`}
        action={
          <Link href="/admin/staff/new" className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" /> 新規登録
          </Link>
        }
      />
      {staff.length === 0 ? (
        <EmptyState message="スタッフが登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>氏名</Th>
              <Th>表示名</Th>
              <Th>連絡先</Th>
              <Th>指名予約</Th>
              <Th className="text-right">担当メニュー</Th>
              <Th>状態</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="font-medium">
                  <Link href={`/admin/staff/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                </Td>
                <Td>{s.displayName ?? '—'}</Td>
                <Td className="text-muted-foreground">{s.email ?? s.phone ?? '—'}</Td>
                <Td>{s.isBookable ? '可' : '不可'}</Td>
                <Td className="text-right tabular-nums">{s._count.serviceStaff}</Td>
                <Td>
                  <StatusPill status={s.status} label={STATUS_LABEL[s.status] ?? s.status} />
                </Td>
                <Td className="text-right">
                  <div className="inline-flex items-center gap-2">
                    <Link
                      href={`/admin/schedule?view=week&staff=${s.id}`}
                      className="rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50"
                    >
                      予定
                    </Link>
                    <Link href={`/admin/staff/${s.id}/schedule`} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50">
                      <CalendarClock className="size-3.5" /> シフト
                    </Link>
                    <Link href={`/admin/staff/${s.id}`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50">
                      編集
                    </Link>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
