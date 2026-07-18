'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, KeyRound, ShieldOff, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setStaffLoginAction, disableStaffLoginAction } from '@/server/actions/admin-actions';

type Login = { email: string; active: boolean } | null;

export function StaffLoginForm({
  staffId,
  shopId,
  defaultEmail,
  login,
}: {
  staffId: string;
  shopId: string;
  defaultEmail: string;
  login: Login;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(login?.email ?? defaultEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setDone(null);
    if (password.length < 8) {
      setError('パスワードは8文字以上で入力してください。');
      return;
    }
    start(async () => {
      const res = await setStaffLoginAction(staffId, shopId, { email, password });
      if (!res.ok) {
        setError(res.error ?? 'アカウントの設定に失敗しました。');
        return;
      }
      setPassword('');
      setDone(res.data?.email ?? email);
      router.refresh();
    });
  };

  const disable = () => {
    if (!window.confirm('このスタッフのログインを無効化しますか？')) return;
    setError(null);
    setDone(null);
    start(async () => {
      const res = await disableStaffLoginAction(staffId, shopId);
      if (!res.ok) {
        setError(res.error ?? '無効化に失敗しました。');
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      {login && (
        <div className="flex items-center justify-between rounded-md border bg-slate-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <span
              className={`inline-block size-2 rounded-full ${login.active ? 'bg-emerald-500' : 'bg-slate-400'}`}
              aria-hidden
            />
            <span className="font-medium">{login.email}</span>
            <span className="text-xs text-muted-foreground">{login.active ? '有効' : '停止中'}</span>
          </span>
          {login.active && (
            <Button variant="ghost" size="sm" onClick={disable} disabled={pending} className="h-7 text-destructive">
              <ShieldOff className="size-3.5" /> 無効化
            </Button>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        メールとパスワードを設定すると、このスタッフは
        <code className="mx-1 rounded bg-muted px-1">/login</code>
        から自分のスケジュール・予約・顧客を確認できます（設定ページは非表示）。
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">ログイン用メール</span>
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@example.com"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{login ? '新しいパスワード' : 'パスワード'}（8文字以上）</span>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </label>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {done && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
          <CheckCircle2 className="size-3.5" />
          {done} のログインを設定しました。メールとパスワードを本人にお伝えください。
        </p>
      )}

      <div>
        <Button size="sm" onClick={submit} disabled={pending || !email}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          {login ? 'パスワードを更新' : 'アカウントを発行'}
        </Button>
      </div>
    </div>
  );
}
