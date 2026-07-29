import type { Metadata } from 'next';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SignupForm } from '@/components/auth/signup-form';

export const metadata: Metadata = {
  title: '無料ではじめる',
  description: 'Yoyaku の30日間無料トライアル。初期費用0円・カード登録不要ではじめられます。',
};

export default function SignupPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-accent via-slate-50 to-slate-50 px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: 'radial-gradient(circle at 30% 10%, hsl(var(--primary) / 0.14) 0, transparent 45%)',
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Sparkles className="size-7" />
          </div>
          <span className="text-lg font-bold tracking-tight">Yoyaku をはじめる</span>
        </div>
        <Card className="border-0 shadow-xl shadow-slate-200/60">
          <CardHeader>
            <CardTitle>30日間 無料トライアル</CardTitle>
            <CardDescription>
              メールアドレスの確認だけで、すぐにお使いいただけます。お支払い情報の登録は不要です。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
