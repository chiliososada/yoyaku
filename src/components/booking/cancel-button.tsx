'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CancelButton({ token }: { token: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/bookings/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'キャンセルに失敗しました。');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました。');
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  return (
    <div className="grid gap-2">
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {!confirming ? (
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          予約をキャンセルする
        </Button>
      ) : (
        <div className="grid gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm">本当にキャンセルしますか？この操作は取り消せません。</p>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={loading} onClick={cancel} className="flex-1">
              {loading ? <Loader2 className="size-4 animate-spin" /> : 'はい、キャンセルする'}
            </Button>
            <Button variant="outline" disabled={loading} onClick={() => setConfirming(false)} className="flex-1">
              戻る
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
