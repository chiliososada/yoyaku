import { Building2, Store, Users, CalendarCheck, Activity } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { getPlatformStats, listTenants } from '@/server/services/platform-service';
import { PageHeader, StatCard, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { formatShortJa } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TENANT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '有効',
  TRIAL: 'トライアル',
  SUSPENDED: '停止',
  CANCELLED: '解約',
};

export default async function PlatformDashboard() {
  await requirePlatformAdmin();
  const stats = await getPlatformStats();
  const tenants = await listTenants();

  return (
    <div>
      <PageHeader title="ダッシュボード" description="プラットフォーム全体の概況" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="商家数" value={stats.tenantCount} icon={Building2} sub={`有効 ${stats.activeTenants}`} />
        <StatCard label="店舗数" value={stats.shopCount} icon={Store} />
        <StatCard label="ユーザー数" value={stats.userCount} icon={Users} />
        <StatCard label="総予約数" value={stats.bookingCount} icon={CalendarCheck} />
        <StatCard label="24時間の予約" value={stats.recentBookings} icon={Activity} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">商家一覧</h2>
      {tenants.length === 0 ? (
        <EmptyState message="商家が登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>商家名</Th>
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
                <Td className="font-medium">{t.name}</Td>
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
