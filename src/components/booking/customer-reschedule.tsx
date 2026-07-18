'use client';

import { useState } from 'react';
import { CalendarClock, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTimeInTz, SLOT_REASON_LABEL } from '@/lib/booking-display';
import { cn } from '@/lib/utils';

type Slot = { startAt: string; available: boolean; reason?: string };

function todayInTz(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

export function CustomerReschedule({ token, timezone }: { token: string; timezone: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => todayInTz(timezone));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setError(null);
    setSelected(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/public/bookings/${token}/availability?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '空き状況の取得に失敗しました。');
      setSlots(data.slots ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました。');
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    if (!selected) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/bookings/${token}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startAt: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? '変更に失敗しました。');
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '変更に失敗しました。');
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <CalendarClock className="size-4" /> 日時を変更する
      </Button>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border p-3">
      <p className="text-sm font-medium">別の日時に変更</p>
      {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="flex items-end gap-2">
        <Input
          type="date"
          value={date}
          min={todayInTz(timezone)}
          onChange={(e) => {
            setDate(e.target.value);
            // 枠は時刻のみ表示のため、日付変更時に旧日付の枠を残すと誤った日へ変更してしまう
            setSlots(null);
            setSelected(null);
          }}
          className="h-9 w-40"
        />
        <Button size="sm" variant="outline" onClick={search} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} 空き検索
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

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!selected || submitting} className="flex-1">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : 'この日時に変更する'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
          やめる
        </Button>
      </div>
    </div>
  );
}
