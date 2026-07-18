'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  deleteStaffAction,
  deleteServiceAction,
  deleteSpecialDayAction,
} from '@/server/actions/admin-actions';

function useDelete(fn: () => Promise<{ ok: boolean; error?: string }>, redirectTo?: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (!window.confirm('削除しますか？この操作は元に戻せません。')) return;
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? '削除に失敗しました。');
        return;
      }
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  };
  return { run, pending, error };
}

export function DeleteStaffButton({ staffId, shopId }: { staffId: string; shopId: string }) {
  const { run, pending, error } = useDelete(() => deleteStaffAction(staffId, shopId), '/admin/staff');
  return (
    <div className="grid gap-1">
      <Button variant="outline" size="sm" onClick={run} disabled={pending} className="text-destructive">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 削除
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function DeleteServiceButton({ serviceId, shopId }: { serviceId: string; shopId: string }) {
  const { run, pending, error } = useDelete(() => deleteServiceAction(serviceId, shopId), '/admin/services');
  return (
    <div className="grid gap-1">
      <Button variant="outline" size="sm" onClick={run} disabled={pending} className="text-destructive">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} 削除
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export function DeleteSpecialDayButton({ id, shopId }: { id: string; shopId: string }) {
  const { run, pending, error } = useDelete(() => deleteSpecialDayAction(id, shopId));
  return (
    <div className="grid justify-items-end gap-0.5">
      <Button variant="ghost" size="sm" onClick={run} disabled={pending} className="h-7 text-destructive">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
