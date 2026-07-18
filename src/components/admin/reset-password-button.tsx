'use client';

import { useState, useTransition } from 'react';
import { Loader2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { resetUserPasswordAction } from '@/server/actions/platform-actions';

/**
 * 商家ユーザーのパスワードを強制リセット。新しいパスワードを1度だけ表示する（運用者が本人へ連絡）。
 */
export function ResetPasswordButton({ userId, email }: { userId: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; newPassword: string } | null>(null);

  const run = () => {
    if (!window.confirm(`${email} のパスワードを再発行しますか？現在のパスワードは無効になります。`)) return;
    setError(null);
    start(async () => {
      const res = await resetUserPasswordAction(userId);
      if (!res.ok || !res.data) {
        setError(res.ok ? '再発行に失敗しました。' : res.error);
        return;
      }
      setResult(res.data);
    });
  };

  if (result) {
    return (
      <div className="inline-flex flex-col items-end gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-left">
        <span className="text-[10px] font-medium text-amber-900">新しいパスワード（一度だけ表示）</span>
        <code className="select-all rounded bg-white px-1.5 py-0.5 text-xs font-bold tracking-wide text-slate-900">
          {result.newPassword}
        </code>
        <span className="text-[10px] text-amber-800/80">本人へ安全に連絡してください。</span>
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Button variant="outline" size="sm" className="h-7" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <><KeyRound className="size-3.5" /> PW再発行</>}
      </Button>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </span>
  );
}
