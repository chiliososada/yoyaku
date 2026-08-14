'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [phase, setPhase] = useState<'password' | 'otp'>('password');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (withOtp: boolean) => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await signIn('credentials', {
        email,
        password,
        ...(withOtp && otp ? { otp } : {}),
        redirect: false,
      });
      if (res?.ok && !res.error) {
        router.push(callbackUrl);
        router.refresh();
        return;
      }
      const code = (res as { code?: string } | undefined)?.code;
      if (code === 'otp_required') {
        setPhase('otp');
        setOtp('');
        setInfo('確認コードをメールに送信しました。届いた 6 桁のコードを入力してください。');
        return;
      }
      if (code === 'otp_invalid') {
        setError('確認コードが正しくないか、期限切れです。');
        return;
      }
      if (code === 'account_locked') {
        setError('ログイン失敗が続いたため、アカウントを一時的にロックしました。15 分ほど待って再度お試しください。');
        return;
      }
      setError('メールアドレスまたはパスワードが正しくありません。');
    } catch {
      setError('ログインに失敗しました。時間をおいて再度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submit(phase === 'otp');
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <MailCheck className="mt-0.5 size-4 shrink-0" />
          {info}
        </div>
      )}

      {phase === 'password' ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">パスワード</Label>
            <PasswordInput
              id="password"
              
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="otp" className="flex items-center gap-1.5">
            <ShieldCheck className="size-4 text-primary" /> 確認コード（6 桁）
          </Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="text-center text-lg tracking-[0.4em]"
            autoFocus
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => submit(false)}
              disabled={loading}
            >
              コードを再送する
            </button>
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => {
                setPhase('password');
                setOtp('');
                setInfo(null);
                setError(null);
              }}
              disabled={loading}
            >
              最初からやり直す
            </button>
          </div>
        </div>
      )}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <Loader2 className="size-4 animate-spin" /> : phase === 'otp' ? '認証してログイン' : 'ログイン'}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        アカウントをお持ちでない方は{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          30日間無料ではじめる
        </Link>
      </p>
    </form>
  );
}
