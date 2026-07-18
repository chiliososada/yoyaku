'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setBillingExemptAction } from '@/server/actions/platform-actions';

interface Props {
  tenantId: string;
  billingExempt: boolean;
  stripeCustomerId: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: '契約中',
  trialing: 'トライアル中',
  past_due: '支払確認中',
  canceled: '解約済み',
};

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function TenantBillingPanel(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !p.billingExempt;
    const msg = next
      ? 'このテナントを課金免除にしますか？（課金ゲート対象外になります）'
      : '課金免除を解除しますか？（契約もトライアルも無い場合、商家後台がロックされます）';
    if (!window.confirm(msg)) return;
    setError(null);
    start(async () => {
      const res = await setBillingExemptAction(p.tenantId, next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2 rounded-xl border bg-white p-4 text-sm">
      <div className="flex items-center gap-1.5 font-semibold">
        <CreditCard className="size-4 text-primary" /> 課金
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Stripe 顧客</dt>
        <dd className="truncate font-mono">{p.stripeCustomerId ?? '未連携'}</dd>
        <dt className="text-muted-foreground">契約状態</dt>
        <dd>{p.subscriptionStatus ? (STATUS_LABEL[p.subscriptionStatus] ?? p.subscriptionStatus) : '—'}</dd>
        <dt className="text-muted-foreground">次回更新</dt>
        <dd>{fmt(p.currentPeriodEnd)}</dd>
        <dt className="text-muted-foreground">トライアル期限</dt>
        <dd>{fmt(p.trialEndsAt)}</dd>
      </dl>
      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs">
          {p.billingExempt ? (
            <>
              <ShieldCheck className="size-3.5 text-indigo-600" /> 課金免除（特約）
            </>
          ) : (
            <>
              <ShieldOff className="size-3.5 text-muted-foreground" /> 課金対象
            </>
          )}
        </span>
        <Button size="sm" variant="outline" onClick={toggle} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {p.billingExempt ? '免除を解除' : '免除にする'}
        </Button>
      </div>
    </div>
  );
}
