/**
 * メール検証の着地点。**ここでテナントが作られ、トライアルが開始する**。
 * サーバーコンポーネントで消費し、結果に応じて案内を出す（トークンは URL から先へ渡さない）。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { verifySignup } from '@/server/services/signup-service';
import { isAppError } from '@/lib/errors';

export const metadata: Metadata = { title: '登録の確認', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SignupVerifyPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token?.trim();
  let error: string | null = null;
  let ok = false;

  if (!token) {
    error = 'リンクが不正です。メール本文のリンクをそのままお開きください。';
  } else {
    try {
      await verifySignup(token);
      ok = true;
    } catch (e) {
      error = isAppError(e)
        ? e.userMessage
        : '登録処理に失敗しました。時間をおいて、もう一度お試しください。';
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-gradient-to-b from-accent via-slate-50 to-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <Card className="border-0 shadow-xl shadow-slate-200/60">
          <CardHeader className="items-center text-center">
            <div
              className={`mb-2 flex size-14 items-center justify-center rounded-2xl ${
                ok ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive'
              }`}
            >
              {ok ? <CheckCircle2 className="size-7" /> : <XCircle className="size-7" />}
            </div>
            <CardTitle>{ok ? '登録が完了しました' : '登録を完了できませんでした'}</CardTitle>
            <CardDescription>
              {ok
                ? '30日間の無料トライアルが始まりました。ログインして初期設定を進めてください。'
                : error}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {ok ? (
              <>
                <Button asChild className="w-full">
                  <Link href="/login">ログインして初期設定へ</Link>
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  お申し込み時のメールアドレスとパスワードでログインできます。
                </p>
              </>
            ) : (
              <Button asChild variant="outline" className="w-full">
                <Link href="/signup">もう一度お申し込みする</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
