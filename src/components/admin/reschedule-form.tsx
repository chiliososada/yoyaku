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
    });
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
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          担当
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="h-9 w-36">
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
          <p className="rounded-md bg-muted/50 py-4 text-center text-sm text-muted-foreground">この日は空き枠がありません。</p>
        ) : (
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
        )
      )}

      <div>
        <Button size="sm" onClick={confirm} disabled={!selected || submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4" />} この日時に変更
        </Button>
      </div>
    </div>
  );
}
