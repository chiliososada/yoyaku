import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { CalendarCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'ログイン' };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-accent via-slate-50 to-slate-50 px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 30% 10%, hsl(var(--primary) / 0.14) 0, transparent 45%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <CalendarCheck className="size-7" />
          </div>
          <span className="text-lg font-bold tracking-tight">予約システム</span>
        </div>
        <Card className="border-0 shadow-xl shadow-slate-200/60">
          <CardHeader>
            <CardTitle>管理画面ログイン</CardTitle>
            <CardDescription>管理者・スタッフアカウントでログインしてください。</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense>
              <LoginForm />
            </Suspense>
            <div className="mt-3 text-center">
              <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary hover:underline">
                パスワードをお忘れですか？
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
