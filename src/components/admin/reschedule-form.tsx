'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CalendarClock, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/admin/form-kit';
import { rescheduleAvailabilityAction, rescheduleBookingAction, type AdminSlot } from '@/server/actions/booking-actions';
import { formatTimeInTz, SLOT_REASON_LABEL } from '@/lib/booking-display';
import { cn } from '@/lib/utils';

export function RescheduleForm({
  bookingId,
  timezone,
  currentDate,
  currentStaffId,
  staffOptions,
}: {
  bookingId: string;
  timezone: string;
  currentDate: string;
  currentStaffId: string | null;
  staffOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(currentDate);
  const [staffId, setStaffId] = useState<string>(currentStaffId ?? '');
  const [slots, setSlots] = useState<AdminSlot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** 表示中の枠がどの条件で取得されたか。日付/担当を変えたら必ず破棄する。 */
  const [searchedFor, setSearchedFor] = useState<{ date: string; staffId: string } | null>(null);
  const [loading, startLoad] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const search = () => {
    setError(null);
    setSelected(null);
    startLoad(async () => {
      const res = await rescheduleAvailabilityAction(bookingId, date, staffId || null);
      if (!res.ok || !res.data) {
        setError(res.ok ? '取得に失敗しました。' : res.error);
        setSlots([]);
        return;
      }
      setSlots(res.data.slots);
      setSearchedFor({ date, staffId });
    });
  };

  /**
   * 条件を変えたら枠と選択を捨てる。
   * 残したままだと、日付を変えても前の日の枠が押せる状態で残り、枠チップは時刻しか出さないため
   * 「6/22 に変えたつもりが 6/15 のまま確定」しても画面上どこにも矛盾が出ない。
   * 予約を店主が意図しない日に動かす操作なので、UI 側で成立させない。
   */
  const changeDate = (v: string) => {
    setDate(v);
    setSlots(null);
    setSelected(null);
    setSearchedFor(null);
    setError(null);
  };
  const changeStaff = (v: string) => {
    setStaffId(v);
    setSlots(null);
    setSelected(null);
    setSearchedFor(null);
    setError(null);
  };

  const confirm = () => {
    if (!selected) return;
    setError(null);
    startSubmit(async () => {
      const res = await rescheduleBookingAction({ bookingId, startAt: selected, staffId: staffId || null });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          日付
          <Input type="date" value={date} onChange={(e) => changeDate(e.target.value)} className="h-9 w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          担当
          <Select value={staffId} onChange={(e) => changeStaff(e.target.value)} className="h-9 w-36">
            <option value="">おまかせ</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </label>
        <Button size="sm" variant="outline" onClick={search} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} 空き枠を表示
        </Button>
      </div>

      {slots && (
        slots.length === 0 ? (
          <p className="rounded-md bg-muted/50 py-4 text-center text-sm text-muted-foreground">
            {searchedFor ? `${searchedFor.date} は空き枠がありません。` : 'この日は空き枠がありません。'}
          </p>
        ) : (
          <div className="grid gap-2">
            {/* 枠チップは時刻しか出さないので、どの日の枠なのかを必ず添える */}
            <p className="text-xs text-muted-foreground">{searchedFor?.date} の空き枠</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map((sl) => {
              const on = selected === sl.startAt;
              return (
                <button
                  key={sl.startAt}
                  type="button"
                  disabled={!sl.available}
                  onClick={() => setSelected(sl.startAt)}
                  className={cn(
                    'flex flex-col items-center rounded-md border py-2 text-sm transition-colors',
                    on && 'border-primary bg-primary text-primary-foreground',
                    !on && sl.available && 'hover:border-primary hover:bg-accent',
                    !sl.available && 'cursor-not-allowed border-dashed bg-muted/30 text-muted-foreground/60',
                  )}
                >
                  <span className="font-medium tabular-nums">{formatTimeInTz(sl.startAt, timezone)}</span>
                  {!sl.available && <span className="text-[10px]">{SLOT_REASON_LABEL[sl.reason ?? ''] ?? '×'}</span>}
                </button>
              );
            })}
            </div>
          </div>
        )
      )}
      {!slots && (
        <p className="text-xs text-muted-foreground">「空き枠を表示」を押すと、選んだ日付・担当の空き時間が出ます。</p>
      )}

      <div>
        <Button size="sm" onClick={confirm} disabled={!selected || submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} この日時に変更
        </Button>
      </div>
    </div>
  );
}
