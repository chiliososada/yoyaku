import Link from 'next/link';
import { CalendarCheck, Clock, Users, Scissors, UserCog, TrendingUp } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import {
  getPrimaryShop,
  getDashboardStats,
  listBookings,
  getBookingTrend,
  getStatusBreakdown,
  getPublishReadiness,
} from '@/server/services/merchant-service';
import { PageHeader, StatCard, Panel, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { BarChart, StatusBreakdown } from '@/components/admin/mini-chart';
import { PublishChecklist } from '@/components/admin/publish-checklist';
import { formatJpy } from '@/lib/utils';
import { formatShortJa, nowUtc } from '@/lib/time';
import { BOOKING_STATUS_LABEL } from '@/lib/booking-display';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const [stats, upcoming, trend, breakdown, readiness] = await Promise.all([
    getDashboardStats(user.tenantId, shop.id, shop.timezone),
    listBookings(user.tenantId, shop.id, { status: 'CONFIRMED', from: nowUtc(), take: 8, order: 'asc' }),
    getBookingTrend(user.tenantId, shop.id, shop.timezone, 14),
    getStatusBreakdown(user.tenantId, shop.id),
    getPublishReadiness(user.tenantId, shop),
  ]);
  const trendTotal = trend.reduce((a, d) => a + d.count, 0);
  const trendRevenue = trend.reduce((a, d) => a + d.revenue, 0);

  return (
    <div>
      <PageHeader
        title="ダッシュボード"
        description={`${shop.name} の予約状況`}
        action={
          <Link
            href="/admin/bookings"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            予約一覧
          </Link>
        }
      />

      <PublishChecklist readiness={readiness} publicUrl={`${env.APP_BASE_URL}${readiness.publicPath}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="本日の予約" value={stats.todayCount} icon={CalendarCheck} sub={`売上 ${formatJpy(stats.todayRevenue)}`} />
        <StatCard label="今後の予約" value={stats.upcomingCount} icon={Clock} />
        <StatCard label="顧客数" value={stats.customerCount} icon={Users} />
        <StatCard label="スタッフ" value={stats.staffCount} icon={UserCog} />
        <StatCard label="メニュー" value={stats.serviceCount} icon={Scissors} />
        <StatCard label="本日売上" value={formatJpy(stats.todayRevenue)} icon={TrendingUp} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={`予約トレンド（直近14日）— 計 ${trendTotal}件 / ${formatJpy(trendRevenue)}`}>
            <BarChart data={trend.map((d) => ({ label: d.label, value: d.count }))} unit="件" />
          </Panel>
        </div>
        <Panel title="ステータス内訳（90日）">
          <StatusBreakdown data={breakdown} labels={BOOKING_STATUS_LABEL} />
        </Panel>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-700">直近の予約</h2>
      {upcoming.length === 0 ? (
        <EmptyState message="今後の予約はありません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>顧客</Th>
              <Th>メニュー</Th>
              <Th>担当</Th>
              <Th>状態</Th>
              <Th className="text-right">料金</Th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((b) => (
              <tr key={b.id}>
                <Td>{formatShortJa(b.startAt, shop.timezone)}</Td>
                <Td className="font-medium">{b.customerName}</Td>
                <Td>{b.service.name}</Td>
                <Td>{b.staff?.displayName ?? b.staff?.name ?? 'おまかせ'}</Td>
                <Td>
                  <StatusPill status={b.status} label={BOOKING_STATUS_LABEL[b.status] ?? b.status} />
                </Td>
                <Td className="text-right tabular-nums">{formatJpy(b.totalPriceJpy)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
