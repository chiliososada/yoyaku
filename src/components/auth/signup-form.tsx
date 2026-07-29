'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestSignupAction } from '@/server/actions/signup-actions';

const EMPTY = { tenantName: '', shopName: '', ownerName: '', email: '', password: '' };

export function SignupForm() {
  const [form, setForm] = useState(EMPTY);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 二重送信ガード（再描画待ちに依存しない）
    setLoading(true);
    setError(null);
    const res = await requestSignupAction({ ...form, agreed });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="grid gap-4">
        <div className="flex items-start gap-2.5 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-sm">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <span>
            確認メールをお送りしました。メール内のリンクを開くと登録が完了し、
            <strong>30日間の無料トライアル</strong>が始まります（有効期限60分）。
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          メールが届かない場合は、迷惑メールフォルダをご確認ください。
        </p>
        <Link href="/login" className="text-center text-sm text-primary hover:underline">
          ログイン画面へ
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="tenantName">会社名・屋号</Label>
        <Input id="tenantName" required maxLength={100} value={form.tenantName} onChange={set('tenantName')} placeholder="例: 株式会社ビューティー" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="shopName">店舗名</Label>
        <Input id="shopName" required maxLength={100} value={form.shopName} onChange={set('shopName')} placeholder="例: サロン 渋谷店" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="ownerName">お名前</Label>
        <Input id="ownerName" required maxLength={100} autoComplete="name" value={form.ownerName} onChange={set('ownerName')} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="password">パスワード</Label>
        <Input id="password" type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        <p className="text-xs text-muted-foreground">10文字以上、英字と数字を含めてください。</p>
      </div>
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          <Link href="/legal/terms" target="_blank" className="text-primary hover:underline">利用規約</Link>
          {' と '}
          <Link href="/legal/privacy" target="_blank" className="text-primary hover:underline">プライバシーポリシー</Link>
          {' に同意します。'}
        </span>
      </label>
      <Button type="submit" disabled={loading || !agreed} className="w-full">
        {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
        30日間 無料ではじめる
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        初期費用0円・カード登録不要・いつでも解約できます。
      </p>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        すでにアカウントをお持ちの方
      </Link>
    </form>
  );
}
