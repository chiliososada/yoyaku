'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction } from '@/server/actions/auth-actions';

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="grid gap-4">
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          リンクが正しくありません。パスワード再設定をもう一度お試しください。
        </div>
        <Link href="/forgot-password" className="text-center text-sm text-primary hover:underline">
          パスワード再設定をやり直す
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <div className="flex items-start gap-2.5 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <span>パスワードを変更しました。新しいパスワードでログインしてください。</span>
        </div>
        <Button onClick={() => router.push('/login')} className="w-full">
          ログイン画面へ
        </Button>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('確認用パスワードが一致しません。');
      return;
    }
    setLoading(true);
    setError(null);
    const res = await resetPasswordAction(token, password);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="password">新しいパスワード</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="8文字以上"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm">新しいパスワード（確認）</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <Loader2 className="size-4 animate-spin" /> : 'パスワードを変更'}
      </Button>
    </form>
  );
}
