'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Trash2, Plus, Loader2, RefreshCw, MessageSquare, Copy, Check, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addEmailRecipientAction,
  removeRecipientAction,
  startLineLinkAction,
} from '@/server/actions/notification-actions';

interface Recipient {
  id: string;
  channel: 'EMAIL' | 'LINE';
  address: string;
  label: string | null;
  active: boolean;
}

interface Props {
  shopId: string;
  recipients: Recipient[];
  lineConfigured: boolean;
  emailConfigured: boolean;
  addFriendUrl: string | null;
  addFriendQrSvg: string | null;
}

function displayAddress(r: Recipient): string {
  if (r.channel === 'EMAIL') return r.address;
  return `LINE ユーザー（…${r.address.slice(-6)}）`;
}

export function NotificationRecipients({
  shopId,
  recipients,
  lineConfigured,
  emailConfigured,
  addFriendUrl,
  addFriendQrSvg,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  // 表示名はメール用と LINE 用で独立（共有すると片方の入力がもう片方に混入し、追加時に両方消える）
  const [emailLabel, setEmailLabel] = useState('');
  const [lineLabel, setLineLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const addEmail = () => {
    setError(null);
    start(async () => {
      const res = await addEmailRecipientAction(shopId, { email, label: emailLabel });
      if (!res.ok) {
        setError(res.error ?? '追加に失敗しました。');
        return;
      }
      setEmail('');
      setEmailLabel('');
      router.refresh();
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('この通知先を削除しますか？')) return;
    setError(null);
    start(async () => {
      const res = await removeRecipientAction(shopId, id);
      if (!res.ok) {
        setError(res.error ?? '削除に失敗しました。');
        return;
      }
      router.refresh();
    });
  };

  const startLink = () => {
    setError(null);
    start(async () => {
      const res = await startLineLinkAction(shopId, { label: lineLabel });
      if (!res.ok) {
        setError(res.error ?? 'コード発行に失敗しました。');
        return;
      }
      setLink({ code: res.data!.code, expiresAt: res.data!.expiresAt });
      setLineLabel('');
    });
  };

  const copyCode = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="grid gap-6">
      {/* 現在の通知先一覧 */}
      <div className="grid gap-2">
        <h3 className="text-sm font-semibold">現在の通知先</h3>
        {recipients.length === 0 ? (
          <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            まだ通知先がありません。下でメール、またはLINEを登録してください。
          </p>
        ) : (
          <ul className="grid gap-2">
            {recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                    r.channel === 'LINE' ? 'bg-emerald-50 text-emerald-600' : 'bg-sky-50 text-sky-600'
                  }`}
                >
                  {r.channel === 'LINE' ? <MessageSquare className="size-4" /> : <Mail className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.label || (r.channel === 'LINE' ? 'LINE通知' : 'メール通知')}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{displayAddress(r)}</div>
                </div>
                {!r.active && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">停止中</span>
                )}
                <button
                  onClick={() => remove(r.id)}
                  disabled={pending}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-slate-50 hover:text-destructive"
                  aria-label="削除"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* メール追加 */}
        <div className="grid content-start gap-3 rounded-xl border p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Mail className="size-4 text-sky-600" /> メールで受け取る
          </h3>
          {!emailConfigured && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              メール送信（SMTP）が未設定のため、登録しても届きません。運営にお問い合わせください。
            </p>
          )}
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">メールアドレス</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tencho@example.com" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">表示名（任意）</span>
            <Input value={emailLabel} onChange={(e) => setEmailLabel(e.target.value)} placeholder="店長 田中" />
          </label>
          <div>
            <Button size="sm" onClick={addEmail} disabled={pending || !email}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} メール通知先を追加
            </Button>
          </div>
        </div>

        {/* LINE 連携 */}
        <div className="grid content-start gap-3 rounded-xl border p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <MessageSquare className="size-4 text-emerald-600" /> LINEで受け取る
          </h3>

          {!lineConfigured ? (
            <p className="flex items-start gap-1.5 rounded-md bg-slate-50 px-2.5 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              LINE通知は準備中です。運営がLINE公式アカウントを設定すると有効になります。
            </p>
          ) : !link ? (
            <>
              <p className="text-xs text-muted-foreground">
                連携コードを発行し、公式アカウントを友だち追加してコードを送信すると、この端末のLINEに通知が届きます。
              </p>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">表示名（任意）</span>
                <Input value={lineLabel} onChange={(e) => setLineLabel(e.target.value)} placeholder="店長 田中" />
              </label>
              <div>
                <Button size="sm" onClick={startLink} disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
                  LINE連携コードを発行
                </Button>
              </div>
            </>
          ) : (
            <div className="grid gap-3">
              <ol className="grid gap-1.5 text-xs text-muted-foreground">
                <li>① 下のQRから公式アカウントを友だち追加</li>
                <li>② トークに下の連携コードを送信</li>
                <li>③「連携が完了しました」と返信が来たら成功</li>
              </ol>
              <div className="flex items-center gap-4 rounded-lg border bg-white p-3">
                {addFriendQrSvg ? (
                  <div className="size-28 shrink-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: addFriendQrSvg }} />
                ) : (
                  <div className="flex size-28 items-center justify-center rounded bg-slate-50 text-[10px] text-muted-foreground">
                    QR準備中
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">連携コード</p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xl font-bold tracking-widest">{link.code}</span>
                    <button
                      onClick={copyCode}
                      className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-slate-50"
                    >
                      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                      {copied ? '済み' : 'コピー'}
                    </button>
                  </div>
                  {addFriendUrl && (
                    <a href={addFriendUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-emerald-700 underline">
                      友だち追加リンクを開く
                    </a>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">30分以内に送信してください。</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => router.refresh()}>
                  <RefreshCw className="size-4" /> 連携できたら更新
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setLink(null)}>
                  閉じる
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
