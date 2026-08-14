'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestSignupAction } from '@/server/actions/signup-actions';
import { signupRequestSchema } from '@/lib/validation/signup';

const EMPTY = { tenantName: '', shopName: '', ownerName: '', email: '', password: '' };

export function SignupForm() {
  const [form, setForm] = useState(EMPTY);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 項目別のエラー。送信前に出す（サーバーまで往復させて全体エラーにしない）。 */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const hasAlnum = /[a-zA-Z]/.test(form.password) && /[0-9]/.test(form.password);
  const pwOk = form.password.length >= 10 && hasAlnum;

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    // 直し始めたら、その項目のエラーは消す
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: '' } : prev));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // 二重送信ガード（再描画待ちに依存しない）

    /**
     * 送信前に項目別で検証する。
     *
     * サーバーまで往復させると、失敗が1本のバナーにまとまってしまい
     * 「どの欄が悪いのか」が分からない。しかも申込にはメール単位の回数制限があるため、
     * パスワードの桁数を間違えただけで残り回数を消費し、最後は1時間ロックされる。
     * 一番大事な最初の1回でそれをやらせない。
     */
    const parsed = signupRequestSchema.safeParse({ ...form, agreed });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !next[key]) next[key] = issue.message;
      }
      setFieldErrors(next);
      setError(null);
      return;
    }
    setFieldErrors({});

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
      <Field id="tenantName" label="会社名・屋号" error={fieldErrors.tenantName}>
        <Input id="tenantName" required maxLength={100} value={form.tenantName} onChange={set('tenantName')} placeholder="例: 株式会社ビューティー" />
      </Field>
      <Field id="shopName" label="店舗名" error={fieldErrors.shopName}>
        <Input id="shopName" required maxLength={100} value={form.shopName} onChange={set('shopName')} placeholder="例: サロン 渋谷店" />
      </Field>
      <Field id="ownerName" label="お名前" error={fieldErrors.ownerName}>
        <Input id="ownerName" required maxLength={100} autoComplete="name" value={form.ownerName} onChange={set('ownerName')} />
      </Field>
      <Field id="email" label="メールアドレス" error={fieldErrors.email}>
        <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set('email')} />
      </Field>
      <Field
        id="password"
        label="パスワード"
        error={fieldErrors.password}
        hint="10文字以上、英字と数字を含めてください。"
      >
        <Input id="password" type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        {/* 入力中に条件を満たしたか分かるようにする（送信して初めて弾かれるのを避ける） */}
        {form.password.length > 0 && !fieldErrors.password && (
          <p className={pwOk ? 'text-xs font-medium text-success' : 'text-xs text-muted-foreground'}>
            {pwOk ? '✓ 条件を満たしています' : `あと${Math.max(0, 10 - form.password.length)}文字以上` + (hasAlnum ? '' : '／英字と数字が必要です')}
          </p>
        )}
      </Field>
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
      {fieldErrors.agreed && (
        <p className="text-xs font-medium text-destructive">{fieldErrors.agreed}</p>
      )}
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

/** ラベル＋入力＋（エラー or 補足）。エラーは補足を置き換えて必ず1行に収める。 */
function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
