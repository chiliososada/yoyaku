import Link from 'next/link';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getDaySchedule, getStaffIdForUser } from '@/server/services/merchant-service';
import { PageHeader } from '@/components/admin/ui';
import { minutesToHHmm, todayInZone } from '@/lib/time';
import { describeIsoDate } from '@/lib/booking-display';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const isDate = (s?: string): s is string =>
  typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

const LABEL_W = 92; // スタッフ名列(px)
const PX_PER_MIN = 1.5; // 1分=1.5px → 1時間=90px
const ROW_H = 56;

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-primary/90 text-primary-foreground hover:bg-primary',
  COMPLETED: 'bg-slate-400 text-white hover:bg-slate-500',
  PENDING: 'bg-amber-400 text-amber-950 hover:bg-amber-500',
};

export default async function SchedulePage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const date = isDate(searchParams.date) ? searchParams.date : todayInZone(shop.timezone);
  const [s, myStaffId] = await Promise.all([
    getDaySchedule(user.tenantId, shop.id, shop.timezone, date),
    getStaffIdForUser(user.tenantId, user.id, shop.id),
  ]);

  const di = describeIsoDate(date);
  const range = s.closeMin - s.openMin;
  const trackW = range * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = Math.ceil(s.openMin / 60); h <= Math.floor(s.closeMin / 60); h++) hours.push(h);
  const leftOf = (min: number) => (min - s.openMin) * PX_PER_MIN;

  return (
    <div>
      <PageHeader
        title="予約スケジュール"
        description={shop.name}
        action={
          <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
            <Link href={`/admin/schedule?date=${s.prevDate}`} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100" aria-label="前日">
              <ChevronLeft className="size-4" />
            </Link>
            <span className={cn('min-w-28 text-center text-sm font-semibold tabular-nums', di.dow === 0 && 'text-red-600', di.dow === 6 && 'text-blue-600')}>
              {di.month}月{di.day}日({di.weekday})
            </span>
            <Link href={`/admin/schedule?date=${s.nextDate}`} className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100" aria-label="翌日">
              <ChevronRight className="size-4" />
            </Link>
            {date !== s.today && (
              <Link href="/admin/schedule" className="ml-1 rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50">
                今日
              </Link>
            )}
          </div>
        }
      />

      {s.isClosed ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 py-16 text-muted-foreground">
          <CalendarDays className="size-8" />
          <p className="text-sm">この日は営業時間が設定されていません（定休日）。</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <div style={{ width: LABEL_W + trackW }}>
            {/* 時間ヘッダ */}
            <div className="flex border-b bg-slate-50/80">
              <div style={{ width: LABEL_W }} className="shrink-0 border-r px-2 py-1.5 text-xs font-medium text-muted-foreground">
                スタッフ
              </div>
              <div className="relative" style={{ width: trackW, height: 28 }}>
                {hours.map((h) => (
                  <span key={h} className="absolute top-1.5 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ left: leftOf(h * 60) }}>
                    {h}:00
                  </span>
                ))}
              </div>
            </div>

            {/* レーン */}
            {s.lanes.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">スタッフがいません。</p>
            ) : (
              s.lanes.map((lane) => {
                const mine = myStaffId != null && lane.key === myStaffId;
                return (
                <div key={lane.key} className={cn('flex border-b last:border-b-0', mine && 'bg-primary/5')}>
                  <div style={{ width: LABEL_W }} className={cn('flex shrink-0 items-center gap-1 border-r px-2 text-sm font-medium', mine && 'border-l-2 border-l-primary')}>
                    <span className="truncate">{lane.name}</span>
                    {mine && <span className="shrink-0 rounded bg-primary px-1 py-0.5 text-[9px] font-bold leading-none text-primary-foreground">自分</span>}
                  </div>
                  <div className="relative" style={{ width: trackW, height: ROW_H }}>
                    {/* 時間グリッド */}
                    {hours.map((h) => (
                      <div key={h} className="absolute inset-y-0 border-l border-slate-100" style={{ left: leftOf(h * 60) }} />
                    ))}
                    {/* 予約ブロック */}
                    {lane.bookings.map((b) => {
                      const w = Math.max(28, (b.endMin - b.startMin) * PX_PER_MIN);
                      return (
                        <Link
                          key={b.id}
                          href={`/admin/bookings/${b.id}`}
                          title={`${minutesToHHmm(b.startMin)}–${minutesToHHmm(b.endMin)} ${b.customerName} / ${b.serviceName}`}
                          className={cn(
                            'absolute top-1.5 bottom-1.5 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-colors',
                            STATUS_STYLE[b.status] ?? 'bg-slate-300 text-slate-900',
                          )}
                          style={{ left: leftOf(b.startMin), width: w }}
                        >
                          <div className="font-semibold tabular-nums">{minutesToHHmm(b.startMin)}</div>
                          <div className="truncate font-medium">{b.customerName}</div>
                          <div className="truncate opacity-90">{b.serviceName}</div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary/90" /> 予約確定</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-slate-400" /> 来店済み</span>
        <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-amber-400" /> 仮予約</span>
        <span>· ブロックをクリックで予約詳細へ</span>
      </div>
    </div>
  );
}
