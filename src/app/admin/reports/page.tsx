import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ChevronRight, Coins, CalendarCheck, TrendingUp, Star, UserPlus, Repeat, Download } from 'lucide-react';
import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { getPrimaryShop, getMonthlyReport } from '@/server/services/merchant-service';
import { PageHeader, StatCard, Panel, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { BarChart } from '@/components/admin/mini-chart';
import { formatJpy } from '@/lib/utils';
import { todayInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

const isMonth = (s?: string): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthLabel = (m: string) => {
  const [y, mm] = m.split('-');
  return `${y}年${Number(mm)}月`;
};
const pct = (v: number) => `${Math.round(v * 100)}%`;
const MEDAL = ['🥇', '🥈', '🥉'];

export default async function ReportsPage({ searchParams }: { searchParams: { month?: string } }) {
  const user = await requireTenantUser();
  // 分析権限（ANALYTICS_READ）必須。ミドルウェアに加えサーバー側でも多層防御。
  if (!hasPermission(user, PERMISSIONS.ANALYTICS_READ)) notFound();
  const shop = await getPrimaryShop(user.tenantId);
  const month = isMonth(searchParams.month) ? searchParams.month : todayInZone(shop.timezone).slice(0, 7);
  const r = await getMonthlyReport(user.tenantId, shop.id, shop.timezone, month);

  return (
    <div>
      <PageHeader
        title="売上・実績レポート"
        description={shop.name}
        action={
          <div className="flex items-center gap-2">
            <a
              href={`/admin/export/bookings?month=${month}`}
              className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              <Download className="size-4" /> CSV
            </a>
          <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
            <Link
              href={`/admin/reports?month=${r.prevMonth}`}
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100"
              aria-label="前月"
            >
              <ChevronLeft className="size-4" />
            </Link>
            <span className="min-w-24 text-center text-sm font-semibold tabular-nums">{monthLabel(month)}</span>
            {r.hasNext ? (
              <Link
                href={`/admin/reports?month=${r.nextMonth}`}
                className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100"
                aria-label="翌月"
              >
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className="inline-flex size-8 items-center justify-center rounded-md text-slate-300">
                <ChevronRight className="size-4" />
              </span>
            )}
          </div>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="売上（確定+来店）" value={formatJpy(r.totalRevenue)} icon={Coins} />
        <StatCard label="予約数" value={r.bookingCount} icon={CalendarCheck} />
        <StatCard label="客単価" value={formatJpy(r.avgSpend)} icon={TrendingUp} />
        <StatCard label="指名率" value={pct(r.nominationRate)} icon={Star} sub={`${r.nominationCount}件`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="新規顧客" value={r.newCustomers} icon={UserPlus} />
        <StatCard label="リピート顧客" value={r.repeatCustomers} icon={Repeat} sub={`リピート率 ${pct(r.repeatRate)}`} />
      </div>

      <div className="mt-6">
        <Panel title={`日別売上（${monthLabel(month)}）`}>
          {r.bookingCount === 0 ? (
            <EmptyState message="この月の実績はまだありません。" />
          ) : (
            <BarChart data={r.daily.map((d) => ({ label: d.label, value: d.revenue }))} unit="円" />
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="スタッフ別実績ランキング">
          {r.byStaff.length === 0 ? (
            <EmptyState message="データがありません。" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-10 text-center">順位</Th>
                  <Th>スタッフ</Th>
                  <Th className="text-right">予約</Th>
                  <Th className="text-right">指名率</Th>
                  <Th className="text-right">客単価</Th>
                  <Th className="text-right">売上</Th>
                </tr>
              </thead>
              <tbody>
                {r.byStaff.map((s, i) => (
                  <tr key={i} className={i === 0 ? 'bg-amber-50/60' : undefined}>
                    <Td className="text-center text-base">{MEDAL[i] ?? <span className="text-sm text-muted-foreground">{i + 1}</span>}</Td>
                    <Td className="font-medium">{s.name}</Td>
                    <Td className="text-right tabular-nums">{s.count}</Td>
                    <Td className="text-right tabular-nums">{s.count ? pct(s.nomination / s.count) : '—'}</Td>
                    <Td className="text-right tabular-nums">{s.count ? formatJpy(Math.round(s.revenue / s.count)) : '—'}</Td>
                    <Td className="text-right font-semibold tabular-nums">{formatJpy(s.revenue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="メニュー別実績（施術料）">
          {r.byMenu.length === 0 ? (
            <EmptyState message="データがありません。" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>メニュー</Th>
                  <Th className="text-right">件数</Th>
                  <Th className="text-right">売上</Th>
                </tr>
              </thead>
              <tbody>
                {r.byMenu.map((m, i) => (
                  <tr key={i}>
                    <Td className="font-medium">{m.name}</Td>
                    <Td className="text-right tabular-nums">{m.count}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatJpy(m.revenue)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        ※ 売上はキャンセル・無断キャンセルを除く「予約確定 + 来店済み」を対象。メニュー別はコンボ予約も明細単位で正確に集計しています。
      </p>
    </div>
  );
}
