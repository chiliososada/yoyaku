import Link from 'next/link';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import {
  getPrimaryShop,
  getDaySchedule,
  getWeekSchedule,
  getStaffIdForUser,
  type ScheduleStaffOption,
  type ShiftSpan,
} from '@/server/services/merchant-service';
import { PageHeader } from '@/components/admin/ui';
import { minutesToHHmm, todayInZone } from '@/lib/time';
import { describeIsoDate } from '@/lib/booking-display';
import { cn } from '@/lib/utils';
import { assignTracks } from '@/lib/schedule-layout';

export const dynamic = 'force-dynamic';

const isDate = (s?: string): s is string =>
  typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);

const LABEL_W = 92; // スタッフ名列(px)
const PX_PER_MIN = 1.5; // 1分=1.5px → 1時間=90px
const ROW_H = 56;

const DOW_JP = ['日', '月', '火', '水', '木', '金', '土'];

const STATUS_STYLE: Record<string, string> = {
  CONFIRMED: 'bg-primary/90 text-primary-foreground hover:bg-primary',
  COMPLETED: 'bg-slate-400 text-white hover:bg-slate-500',
  PENDING: 'bg-amber-400 text-amber-950 hover:bg-amber-500',
};

/** 表示条件を保ったままリンクを組み立てる（切替でスタッフ絞り込みが消えると使い物にならない）。 */
function hrefFor(params: { date?: string; view?: 'day' | 'week'; staff?: string | null }): string {
  const q = new URLSearchParams();
  if (params.date) q.set('date', params.date);
  if (params.view === 'week') q.set('view', 'week');
  if (params.staff) q.set('staff', params.staff);
  const s = q.toString();
  return s ? `/admin/schedule?${s}` : '/admin/schedule';
}

/** 勤務時間の要約（例: 10:00–19:00 / 10:00–13:00, 15:00–19:00）。 */
function shiftLabel(shifts: ShiftSpan[]): string {
  return shifts.map((s) => `${minutesToHHmm(s.startMin)}–${minutesToHHmm(s.endMin)}`).join(', ');
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: { date?: string; view?: string; staff?: string };
}) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const date = isDate(searchParams.date) ? searchParams.date : todayInZone(shop.timezone);
  const view = searchParams.view === 'week' ? 'week' : 'day';
  const staffParam = searchParams.staff || null;

  const [dayBoard, weekBoard, myStaffId] = await Promise.all([
    view === 'day' ? getDaySchedule(user.tenantId, shop.id, shop.timezone, date, staffParam) : null,
    view === 'week' ? getWeekSchedule(user.tenantId, shop.id, shop.timezone, date, staffParam) : null,
    getStaffIdForUser(user.tenantId, user.id, shop.id),
  ]);

  const board = dayBoard ?? weekBoard!;
  const staffOptions = board.staffOptions;
  // 実際に適用された絞り込みに従う。サービス側で未知のIDは null へ丸めているので、
  // ここで別途判定すると「チップは全員、表は空」というちぐはぐな状態になる。
  const staff = board.selectedStaffId;

  return (
    <div>
      <PageHeader
        title="予約スケジュール"
        description={shop.name}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle view={view} date={date} staff={staff} />
            <DateNav view={view} board={board} staff={staff} />
          </div>
        }
      />

      <StaffFilter options={staffOptions} selected={staff} date={date} view={view} myStaffId={myStaffId} />

      {weekBoard ? (
        <WeekBoard board={weekBoard} staff={staff} myStaffId={myStaffId} />
      ) : (
        <DayBoard board={dayBoard!} myStaffId={myStaffId} />
      )}
    </div>
  );
}

function ViewToggle({ view, date, staff }: { view: 'day' | 'week'; date: string; staff: string | null }) {
  const item = (v: 'day' | 'week', label: string) => (
    <Link
      href={hrefFor({ date, view: v, staff })}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-slate-100',
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
      {item('day', '日')}
      {item('week', '週')}
    </div>
  );
}

function DateNav({
  view,
  board,
  staff,
}: {
  view: 'day' | 'week';
  board: { prevDate: string; nextDate: string; today: string } & ({ date: string } | { from: string; to: string });
  staff: string | null;
}) {
  const label =
    'date' in board
      ? (() => {
          const di = describeIsoDate(board.date);
          return (
            <span
              className={cn(
                'min-w-28 text-center text-sm font-semibold tabular-nums',
                di.dow === 0 && 'text-red-600',
                di.dow === 6 && 'text-blue-600',
              )}
            >
              {di.month}月{di.day}日({di.weekday})
            </span>
          );
        })()
      : (() => {
          const a = describeIsoDate(board.from);
          const b = describeIsoDate(board.to);
          return (
            <span className="min-w-36 text-center text-sm font-semibold tabular-nums">
              {a.month}/{a.day} – {b.month}/{b.day}
            </span>
          );
        })();

  const isCurrent = 'date' in board ? board.date === board.today : board.from <= board.today && board.today <= board.to;

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-white p-1">
      <Link
        href={hrefFor({ date: board.prevDate, view, staff })}
        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100"
        aria-label={view === 'week' ? '前週' : '前日'}
      >
        <ChevronLeft className="size-4" />
      </Link>
      {label}
      <Link
        href={hrefFor({ date: board.nextDate, view, staff })}
        className="inline-flex size-8 items-center justify-center rounded-md hover:bg-slate-100"
        aria-label={view === 'week' ? '翌週' : '翌日'}
      >
        <ChevronRight className="size-4" />
      </Link>
      {!isCurrent && (
        <Link href={hrefFor({ view, staff })} className="ml-1 rounded-md border px-2.5 py-1 text-xs hover:bg-slate-50">
          {view === 'week' ? '今週' : '今日'}
        </Link>
      )}
    </div>
  );
}

function StaffFilter({
  options,
  selected,
  date,
  view,
  myStaffId,
}: {
  options: ScheduleStaffOption[];
  selected: string | null;
  date: string;
  view: 'day' | 'week';
  myStaffId: string | null;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">スタッフ</span>
      <Link
        href={hrefFor({ date, view })}
        className={cn(
          'rounded-full border px-3 py-1.5 text-sm transition-colors',
          selected === null ? 'border-primary bg-primary text-primary-foreground' : 'bg-white hover:border-primary',
        )}
      >
        全員
      </Link>
      {options.map((o) => (
        <Link
          key={o.id}
          href={hrefFor({ date, view, staff: o.id })}
          className={cn(
            'rounded-full border px-3 py-1.5 text-sm transition-colors',
            selected === o.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-white hover:border-primary',
          )}
        >
          {o.name}
          {o.id === myStaffId && <span className="ml-1 text-[10px] opacity-70">(自分)</span>}
        </Link>
      ))}
    </div>
  );
}

// ---- 日表示 ----

function DayBoard({
  board: s,
  myStaffId,
}: {
  board: Awaited<ReturnType<typeof getDaySchedule>>;
  myStaffId: string | null;
}) {
  const range = s.closeMin - s.openMin;
  const trackW = range * PX_PER_MIN;
  const hours: number[] = [];
  for (let h = Math.ceil(s.openMin / 60); h <= Math.floor(s.closeMin / 60); h++) hours.push(h);
  const leftOf = (min: number) => (min - s.openMin) * PX_PER_MIN;

  if (s.isClosed) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 py-16 text-muted-foreground">
        <CalendarDays className="size-8" />
        <p className="text-sm">
          この日は休業です{s.closedLabel ? `（${s.closedLabel}${s.holidayName ? ` · ${s.holidayName}` : ''}）` : ''}。
        </p>
      </div>
    );
  }

  return (
    <>
      {/* 休業日に予約が残っていると isClosed=false になる（店主が対応できるように閉じない）。
          このとき理由を出さないと「なぜ全員が休みなのか」が画面のどこにも書かれていない状態になる。 */}
      {s.closedLabel && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          この日は<strong>{s.closedLabel}</strong>です
          {s.holidayName ? `（${s.holidayName}）` : ''}。
          残っているご予約は自動ではキャンセルされません。お客様へのご連絡をご確認ください。
        </p>
      )}
      {!s.closedLabel && s.holidayName && (
        <p className="mb-2 text-xs text-muted-foreground">{s.holidayName}（営業）</p>
      )}
      {/* 枠は中身に合わせる。固定幅のタイムラインを全幅のカードに入れると、
          右側に用途不明の白地が残って「まだ何かあるのか」と見える。 */}
      <div className="w-fit max-w-full overflow-x-auto rounded-xl border bg-white">
        <div style={{ width: LABEL_W + trackW }}>
          {/* 時間ヘッダ */}
          <div className="flex border-b bg-slate-50/80">
            <div style={{ width: LABEL_W }} className="shrink-0 border-r px-2 py-1.5 text-xs font-medium text-muted-foreground">
              スタッフ
            </div>
            <div className="relative" style={{ width: trackW, height: 28 }}>
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute top-1.5 -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
                  style={{ left: leftOf(h * 60) }}
                >
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
              const isUnassigned = lane.key === '__none__';
              const { blocks, trackCount } = assignTracks(lane.bookings);
              const laneH = Math.max(ROW_H, trackCount * 40);
              const blockH = laneH / trackCount;
              return (
                <div key={lane.key} className={cn('flex border-b last:border-b-0', mine && 'bg-primary/5')}>
                  <div
                    style={{ width: LABEL_W }}
                    className={cn(
                      'flex shrink-0 flex-col justify-center gap-0.5 border-r px-2 py-1 text-sm font-medium',
                      mine && 'border-l-2 border-l-primary',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span className="truncate">{lane.name}</span>
                      {mine && (
                        <span className="shrink-0 rounded bg-primary px-1 py-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                          自分
                        </span>
                      )}
                    </span>
                    {/* 出勤していない日は名前の下でも分かるようにする */}
                    {lane.inactive ? (
                      <span className="truncate text-[10px] font-normal text-amber-700">退職・停止中</span>
                    ) : (
                      !isUnassigned && (
                        <span className="truncate text-[10px] font-normal tabular-nums text-muted-foreground">
                          {lane.shifts.length > 0 ? shiftLabel(lane.shifts) : '休み'}
                        </span>
                      )
                    )}
                  </div>
                  <div className="relative bg-slate-200/70" style={{ width: trackW, height: laneH }}>
                    {/* 勤務時間だけを白く抜く。灰色＝この時間は出勤していない、が一目で分かる。 */}
                    {lane.shifts.map((sh) => (
                      <div
                        key={`${sh.startMin}-${sh.endMin}`}
                        className="absolute inset-y-0 bg-white"
                        style={{ left: leftOf(sh.startMin), width: (sh.endMin - sh.startMin) * PX_PER_MIN }}
                      />
                    ))}
                    {(isUnassigned || lane.inactive) && <div className="absolute inset-0 bg-white" />}
                    {/* 時間グリッド */}
                    {hours.map((h) => (
                      <div key={h} className="absolute inset-y-0 border-l border-slate-200/70" style={{ left: leftOf(h * 60) }} />
                    ))}
                    {/* 予約ブロック（重なりは段に分けて全件を見える・押せる状態にする） */}
                    {blocks.map((b) => {
                      const w = Math.max(28, (b.endMin - b.startMin) * PX_PER_MIN);
                      return (
                        <Link
                          key={b.id}
                          href={`/admin/bookings/${b.id}`}
                          title={`${minutesToHHmm(b.startMin)}–${minutesToHHmm(b.endMin)} ${b.customerName} / ${b.serviceName}`}
                          className={cn(
                            'absolute overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight shadow-sm transition-colors',
                            STATUS_STYLE[b.status] ?? 'bg-slate-300 text-slate-900',
                          )}
                          style={{
                            left: leftOf(b.startMin),
                            width: w,
                            top: b.track * blockH + 3,
                            height: blockH - 6,
                          }}
                        >
                          <div className="font-semibold tabular-nums">{minutesToHHmm(b.startMin)}</div>
                          <div className="truncate font-medium">{b.customerName}</div>
                          {trackCount === 1 && <div className="truncate opacity-90">{b.serviceName}</div>}
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

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-primary/90" /> 予約確定
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-slate-400" /> 来店済み
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-amber-400" /> 仮予約
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm border bg-white" /> 出勤時間
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-slate-200/70 ring-1 ring-inset ring-slate-300" /> 勤務外
        </span>
        <span>· ブロックをクリックで予約詳細へ</span>
      </div>
    </>
  );
}

// ---- 週表示（縦: スタッフ / 横: 7日）----

function WeekBoard({
  board: w,
  staff,
  myStaffId,
}: {
  board: Awaited<ReturnType<typeof getWeekSchedule>>;
  staff: string | null;
  myStaffId: string | null;
}) {
  if (w.rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border bg-muted/30 py-16 text-muted-foreground">
        <CalendarDays className="size-8" />
        <p className="text-sm">スタッフがいません。</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50/80">
              <th className="sticky left-0 z-10 w-28 border-b border-r bg-slate-50/80 px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                スタッフ
              </th>
              {w.columns.map((c) => (
                <th
                  key={c.date}
                  className={cn(
                    'border-b border-r px-2 py-2 text-center align-top last:border-r-0',
                    c.isToday && 'bg-primary/10',
                  )}
                >
                  <div
                    className={cn(
                      'text-xs font-semibold tabular-nums',
                      c.dow === 0 && 'text-red-600',
                      c.dow === 6 && 'text-blue-600',
                    )}
                  >
                    {c.month}/{c.day}({DOW_JP[c.dow]})
                  </div>
                  {c.holidayName && <div className="text-[10px] font-normal text-red-500">{c.holidayName}</div>}
                  {c.closedLabel && <div className="text-[10px] font-normal text-muted-foreground">{c.closedLabel}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {w.rows.map((row) => {
              const mine = myStaffId != null && row.staffId === myStaffId;
              return (
                <tr key={row.staffId} className={cn(mine && 'bg-primary/5')}>
                  <th
                    className={cn(
                      'sticky left-0 z-10 border-b border-r bg-white px-3 py-2 text-left font-medium',
                      mine && 'border-l-2 border-l-primary bg-primary/5',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span className="truncate">{row.name}</span>
                      {mine && (
                        <span className="shrink-0 rounded bg-primary px-1 py-0.5 text-[9px] font-bold leading-none text-primary-foreground">
                          自分
                        </span>
                      )}
                    </span>
                    {row.inactive && (
                      <span className="block text-[10px] font-normal text-amber-700">退職・停止中</span>
                    )}
                  </th>
                  {row.days.map((d, i) => {
                    const col = w.columns[i]!;
                    const off = d.shifts.length === 0;
                    return (
                      <td
                        key={d.date}
                        className={cn(
                          'border-b border-r px-2 py-2 text-center align-top last:border-r-0',
                          off && 'bg-slate-50 text-muted-foreground',
                          col.isToday && !off && 'bg-primary/[0.04]',
                        )}
                      >
                        <Link
                          href={hrefFor({ date: d.date, view: 'day', staff })}
                          className="block rounded transition-colors hover:bg-slate-100"
                        >
                          {off ? (
                            <span className="text-xs">
                              {row.inactive ? '—' : col.isClosed ? (col.closedLabel ?? '休業') : '休み'}
                            </span>
                          ) : (
                            <span className="text-xs font-medium tabular-nums text-slate-800">
                              {d.shifts.map((sh) => (
                                <span key={sh.startMin} className="block whitespace-nowrap">
                                  {minutesToHHmm(sh.startMin)}–{minutesToHHmm(sh.endMin)}
                                </span>
                              ))}
                            </span>
                          )}
                          {d.bookingCount > 0 && (
                            <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              予約{d.bookingCount}
                            </span>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>時刻＝その日の実際の勤務時間（曜日シフト・個別の出欠・店休日を反映）</span>
        <span>· 日付セルをクリックでその日の詳細へ</span>
      </div>
    </>
  );
}
