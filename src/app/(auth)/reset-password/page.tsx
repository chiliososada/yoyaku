import type { Metadata } from 'next';
import { KeyRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = { title: 'パスワード再設定' };

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams.token === 'string' ? searchParams.token : null;
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-accent via-slate-50 to-slate-50 px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle at 30% 10%, hsl(var(--primary) / 0.14) 0, transparent 45%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <KeyRound className="size-7" />
          </div>
          <span className="text-lg font-bold tracking-tight">新しいパスワードの設定</span>
        </div>
        <Card className="border-0 shadow-xl shadow-slate-200/60">
          <CardHeader>
            <CardTitle>新しいパスワード</CardTitle>
            <CardDescription>新しいパスワードを入力してください。</CardDescription>
          </CardHeader>
          <CardContent>
            <ResetPasswordForm token={token} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
