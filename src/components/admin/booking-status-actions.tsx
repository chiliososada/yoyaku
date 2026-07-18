'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, UserX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateBookingStatusAction } from '@/server/actions/booking-actions';
import type { BookingStatus } from '@/server/services/booking-admin-service';

const ACTIONS: Record<string, { to: BookingStatus; label: string; icon: React.ComponentType<{ className?: string }>; variant: 'default' | 'destructive' | 'outline'; confirm?: boolean }[]> = {
  PENDING: [
    { to: 'CONFIRMED', label: '予約を確定', icon: Check, variant: 'default' },
    { to: 'CANCELLED', label: 'キャンセル', icon: X, variant: 'destructive', confirm: true },
  ],
  CONFIRMED: [
    { to: 'COMPLETED', label: '来店完了', icon: Check, variant: 'default' },
    { to: 'NO_SHOW', label: '無断キャンセル', icon: UserX, variant: 'outline', confirm: true },
    { to: 'CANCELLED', label: 'キャンセル', icon: X, variant: 'destructive', confirm: true },
  ],
};

export function BookingStatusActions({ bookingId, status }: { bookingId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyTo, setBusyTo] = useState<string | null>(null);

  const actions = ACTIONS[status] ?? [];
  if (actions.length === 0) {
    return <p className="text-sm text-muted-foreground">この予約は確定状態ではありません（操作はありません）。</p>;
  }

  const run = (to: BookingStatus, confirm?: boolean) => {
    if (confirm && !window.confirm('この操作を実行しますか？')) return;
    setError(null);
    setBusyTo(to);
    startTransition(async () => {
      const res = await updateBookingStatusAction({ bookingId, toStatus: to });
      setBusyTo(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a.to}
            variant={a.variant}
            size="sm"
            disabled={pending}
            onClick={() => run(a.to, a.confirm)}
          >
            {pending && busyTo === a.to ? <Loader2 className="size-4 animate-spin" /> : <a.icon className="size-4" />}
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
