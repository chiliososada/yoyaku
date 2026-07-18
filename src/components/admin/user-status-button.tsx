'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setUserStatusAction } from '@/server/actions/platform-actions';

export function UserStatusButton({ userId, status }: { userId: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const next = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

  const run = () => {
    if (!window.confirm(next === 'SUSPENDED' ? 'このユーザーを停止しますか？' : 'このユーザーを有効化しますか？')) return;
    setError(null);
    start(async () => {
      const res = await setUserStatusAction(userId, next as 'ACTIVE' | 'SUSPENDED');
      if (!res.ok) { setError(res.error); return; }
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button variant="outline" size="sm" className="h-7" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : next === 'SUSPENDED' ? '停止' : '有効化'}
      </Button>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}
