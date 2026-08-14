'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, FileText, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { requestSignupAction } from '@/server/actions/signup-actions';
import { signupRequestSchema } from '@/lib/validation/signup';
import { checkPassword, PASSWORD_MIN, PASSWORD_RULE_TEXT } from '@/lib/validation/password';
import { LegalConsentDialog } from '@/components/auth/legal-consent';

const EMPTY = { tenantName: '', shopName: '', ownerName: '', email: '', password: '' };

export function SignupForm() {
  const [form, setForm] = useState(EMPTY);
  const [agreed, setAgreed] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 項目別のエラー。送信前に出す（サーバーまで往復させて全体エラーにしない）。 */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const pw = checkPassword(form.password);

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
        hint={form.password.length === 0 && !fieldErrors.password ? PASSWORD_RULE_TEXT : undefined}
      >
        <PasswordInput id="password" required autoComplete="new-password" value={form.password} onChange={set('password')} />
        {/*
          条件は個別のチップで示す。ここに加えて「パスワードは6文字以上にしてください。」という
          文も出すと、同じことを2行で言うことになる。未達の項目を赤にするだけで足りる。
        */}
        {(form.password.length > 0 || fieldErrors.password) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <Req ok={pw.lengthOk} label={`${PASSWORD_MIN}文字以上`} failed={!!fieldErrors.password} />
            <Req ok={pw.upperOk} label="大文字" failed={!!fieldErrors.password} />
            <Req ok={pw.lowerOk} label="小文字" failed={!!fieldErrors.password} />
            <Req ok={pw.digitOk} label="数字" failed={!!fieldErrors.password} />
          </div>
        )}
      </Field>
      {/* 規約は別タブへ飛ばさずその場で読ませる。読了までボタンを押せない（同意の実質を伴わせる）。 */}
      <div className="rounded-lg border bg-muted/30 p-3">
        {agreed ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" /> 利用規約・プライバシーポリシーに同意済み
            </span>
            <button
              type="button"
              onClick={() => setLegalOpen(true)}
              className="shrink-0 text-xs text-primary hover:underline"
            >
              もう一度読む
            </button>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              お申し込みには
              <Link href="/legal/terms" target="_blank" className="mx-0.5 text-primary hover:underline">利用規約</Link>
              と
              <Link href="/legal/privacy" target="_blank" className="mx-0.5 text-primary hover:underline">プライバシーポリシー</Link>
              への同意が必要です。
            </p>
            <Button type="button" variant="outline" onClick={() => setLegalOpen(true)} className="w-full">
              <FileText className="size-4" /> 内容を読んで同意する
            </Button>
          </>
        )}
      </div>

      {fieldErrors.agreed && (
        <p className="text-xs font-medium text-destructive">{fieldErrors.agreed}</p>
      )}
      <LegalConsentDialog open={legalOpen} onClose={() => setLegalOpen(false)} onAgree={() => setAgreed(true)} />

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

/**
 * パスワード条件の1項目。満たすと緑。
 * 送信を試みて弾かれた後だけ、未達の項目を赤くする（入力途中から赤いと急かして見える）。
 */
function Req({ ok, label, failed }: { ok: boolean; label: string; failed?: boolean }) {
  return (
    <span
      className={
        ok ? 'font-medium text-success' : failed ? 'font-medium text-destructive' : 'text-muted-foreground'
      }
    >
      {ok ? '✓' : '・'} {label}
    </span>
  );
}
