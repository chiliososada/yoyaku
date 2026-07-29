'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { retryFailedNotificationAction } from '@/server/actions/notification-actions';

export interface FailedNotificationView {
  id: string;
  channel: string;
  template: string;
  recipient: string;
  attempts: number;
  lastError: string | null;
  /** 表示用に整形済み（サーバー側で店舗TZ変換） */
  createdAtLabel: string;
  booking: { id: string; startAtLabel: string; customerName: string } | null;
}

const TEMPLATE_LABEL: Record<string, string> = {
  BOOKING_CONFIRMED: '予約確認',
  BOOKING_REMINDER: '前日リマインド',
  BOOKING_CANCELLED: 'キャンセル通知',
  BOOKING_RESCHEDULED: '日時変更のお知らせ',
};

/** 宛先はそのまま出さない（LINE の userId は長く、画面を圧迫し漏えい面でも不要）。 */
function maskRecipient(channel: string, recipient: string): string {
  if (channel === 'LINE') return `LINE（…${recipient.slice(-6)}）`;
  return recipient;
}

export function FailedNotifications({ shopId, items }: { shopId: string; items: FailedNotificationView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<string[]>([]);

  const retry = (id: string) => {
    setError(null);
    setBusyId(id);
    start(async () => {
      const res = await retryFailedNotificationAction(shopId, id);
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDoneIds((prev) => [...prev, id]);
      router.refresh();
    });
  };

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        <CheckCircle2 className="size-4 shrink-0" />
        配信できなかった通知はありません。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">{items.length} 件の通知がお客様・スタッフに届いていません。</p>
          <p className="mt-0.5 text-xs text-amber-800/80">
            メールアドレスの誤りや、LINE のブロック・一時的な障害が原因です。宛先をご確認のうえ「再送する」をお試しください。
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {items.map((it) => {
          const requeued = doneIds.includes(it.id);
          return (
            <li key={it.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                    {it.channel === 'LINE' ? <MessageSquare className="size-3" /> : <Mail className="size-3" />}
                    {TEMPLATE_LABEL[it.template] ?? it.template}
                  </span>
                  <span className="text-sm font-medium text-slate-800">{maskRecipient(it.channel, it.recipient)}</span>
                  <span className="text-xs text-muted-foreground">{it.attempts} 回試行</span>
                </div>
                {it.booking && (
                  <p className="mt-1 text-sm text-slate-600">
                    {it.booking.customerName} 様 / {it.booking.startAtLabel}
                    <Link
                      href={`/admin/bookings/${it.booking.id}`}
                      className="ml-2 text-xs text-primary hover:underline"
                    >
                      予約を開く
                    </Link>
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">発生: {it.createdAtLabel}</p>
                {it.lastError && (
                  <p className="mt-1 truncate text-xs text-slate-400" title={it.lastError}>
                    {it.lastError}
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {requeued ? (
                  <span className="inline-flex items-center gap-1.5 text-sm text-green-700">
                    <CheckCircle2 className="size-4" /> 再送キューに戻しました
                  </span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => retry(it.id)} disabled={pending}>
                    {pending && busyId === it.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    再送する
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
