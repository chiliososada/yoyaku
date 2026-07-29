'use client';

import { useState, useTransition } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatJpy } from '@/lib/utils';
import { startCheckoutAction, openBillingPortalAction } from '@/server/actions/billing-actions';

interface PlanCard {
  id: string;
  name: string;
  description: string | null;
  priceJpy: number;
  maxShops: number;
  maxStaffPerShop: number;
}

interface Props {
  state: 'DORMANT' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'CANCELED_GRACE' | 'LOCKED';
  trialDaysLeft?: number;
  /** CANCELED_GRACE のとき、いつまで使えるか（ISO 文字列） */
  accessUntil?: string | null;
  canManage: boolean;
  hasPaymentAccount: boolean;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  planName: string | null;
  planPriceJpy: number | null;
  plans: PlanCard[];
  checkoutResult: string | null;
  /** 当月のオンライン予約利用状況（プラン上限に対する使用量） */
  quota?: { used: number; limit: number; planName: string };
}

const STATUS_LABEL: Record<string, string> = {
  active: 'ご契約中',
  trialing: 'トライアル中（Stripe）',
  past_due: 'お支払い確認中',
  canceled: '解約済み',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function BillingPanel(props: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);

  const checkout = (planId: string) => {
    setError(null);
    setBusyPlanId(planId);
    start(async () => {
      const res = await startCheckoutAction(planId);
      if (!res.ok || !res.data?.url) {
        setError(res.ok ? 'URL の取得に失敗しました。' : res.error);
        setBusyPlanId(null);
        return;
      }
      window.location.href = res.data.url;
    });
  };

  const openPortal = () => {
    setError(null);
    start(async () => {
      const res = await openBillingPortalAction();
      if (!res.ok || !res.data?.url) {
        setError(res.ok ? 'URL の取得に失敗しました。' : res.error);
        return;
      }
      window.location.href = res.data.url;
    });
  };

  // Checkout から戻った直後はプランカードを出さない。
  // Webhook 同期の前は state が TRIAL/LOCKED のままなので、カードを出すと
  //「決済したのに変わらない → もう一度申し込む」を誘発し、契約が二本になる。
  // 解約猶予中（CANCELED_GRACE）も再契約できるようカードを出す（startCheckout も canceled は許可）。
  const showPlans =
    props.canManage &&
    props.checkoutResult !== 'success' &&
    (props.state === 'TRIAL' || props.state === 'LOCKED' || props.state === 'CANCELED_GRACE');

  return (
    <div className="grid gap-5">
      {props.checkoutResult === 'success' && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          お申し込みありがとうございます。契約状態への反映には数秒かかることがあります（このページを再読み込みしてください）。
        </div>
      )}
      {props.checkoutResult === 'canceled' && (
        <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          お申し込みは完了していません。いつでも再開できます。
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* 現在の状態 */}
      {props.state === 'DORMANT' && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">オンライン決済は準備中です</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              ご契約・お支払いについては運営までお問い合わせください。
            </p>
          </div>
        </div>
      )}

      {props.state === 'EXEMPT' && (
        <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-indigo-600" />
          <div>
            <p className="font-medium text-indigo-900">特別契約プラン</p>
            <p className="mt-0.5 text-xs text-indigo-800/80">
              このアカウントは個別契約のため、オンラインでのお手続きは不要です。
            </p>
          </div>
        </div>
      )}

      {props.state === 'SUBSCRIBED' && (
        <div className="grid gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={
                props.subscriptionStatus === 'past_due'
                  ? 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800'
                  : 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800'
              }
            >
              {props.subscriptionStatus === 'past_due' ? (
                <TriangleAlert className="size-3.5" />
              ) : (
                <BadgeCheck className="size-3.5" />
              )}
              {STATUS_LABEL[props.subscriptionStatus ?? ''] ?? props.subscriptionStatus}
            </span>
            {props.planName && (
              <span className="text-sm font-semibold">
                {props.planName}
                {props.planPriceJpy != null && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {formatJpy(props.planPriceJpy)}/月
                  </span>
                )}
              </span>
            )}
          </div>
          {props.subscriptionStatus === 'past_due' && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              お支払いの確認が取れていません。お支払い方法をご確認ください（未解決の場合、後台のご利用が停止されます）。
            </p>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" /> 次回更新日: {fmtDate(props.currentPeriodEnd)}
          </p>
          {props.canManage && props.hasPaymentAccount && (
            <div>
              <Button variant="outline" size="sm" onClick={openPortal} disabled={pending}>
                {pending && !busyPlanId ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                お支払い方法・解約の管理
              </Button>
            </div>
          )}
        </div>
      )}

      {props.state === 'TRIAL' && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-sky-600" />
          <div>
            <p className="font-medium text-sky-900">
              無料トライアル中（残り {props.trialDaysLeft ?? 0} 日）
            </p>
            <p className="mt-0.5 text-xs text-sky-800/80">
              期間中にプランへお申し込みいただくと、そのまま継続してご利用いただけます。
            </p>
          </div>
        </div>
      )}

      {props.state === 'CANCELED_GRACE' && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900">
              解約済み — {fmtDate(props.accessUntil ?? null)}までご利用いただけます
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80">
              お支払い済み期間の末日まで、これまでどおりすべての機能をお使いいただけます。
              {props.canManage
                ? '再開をご希望の場合は、下記のプランからお申し込みください。'
                : '再開をご希望の場合は、オーナーの方にお申し込みをご依頼ください。'}
            </p>
          </div>
        </div>
      )}

      {props.state === 'LOCKED' && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <Lock className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">無料トライアルが終了しました</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {props.canManage
                ? '引き続きご利用いただくには、下記のプランにお申し込みください。予約ページ（お客様向け）は引き続き稼働しています。'
                : 'ご利用を再開するには、オーナーの方がプランへお申し込みください。'}
            </p>
          </div>
        </div>
      )}

      {/* 当月のオンライン予約利用状況（上限に近づいたら事前に気づけるように） */}
      {props.quota && props.quota.limit > 0 && props.state !== 'EXEMPT' && props.state !== 'DORMANT' && (
        <QuotaMeter used={props.quota.used} limit={props.quota.limit} planName={props.quota.planName} />
      )}

      {/* プラン一覧（申込） */}
      {showPlans && (
        <div className="grid gap-3">
          <h3 className="text-sm font-semibold">プランを選択</h3>
          {props.plans.length === 0 ? (
            <p className="rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              現在お申し込み可能なプランがありません。運営までお問い合わせください。
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {props.plans.map((p) => (
                <div key={p.id} className="grid content-start gap-2 rounded-xl border bg-white p-4">
                  <div className="text-sm font-semibold">{p.name}</div>
                  <div className="text-2xl font-bold tracking-tight">
                    {formatJpy(p.priceJpy)}
                    <span className="text-xs font-normal text-muted-foreground">/月（税込）</span>
                  </div>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  <p className="text-[11px] text-muted-foreground">
                    店舗 {p.maxShops} まで・スタッフ {p.maxStaffPerShop} 名/店舗
                  </p>
                  <Button size="sm" onClick={() => checkout(p.id)} disabled={pending}>
                    {pending && busyPlanId === p.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CreditCard className="size-4" />
                    )}
                    このプランで申し込む
                  </Button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            お支払いは Stripe の安全な決済ページで行われます。カード情報が当システムに保存されることはありません。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 当月のオンライン予約件数 / プラン上限。
 * 上限に達してから知るのでは遅いため、80% を超えた時点で警告色に変える。
 */
function QuotaMeter({ used, limit, planName }: { used: number; limit: number; planName: string }) {
  const ratio = limit > 0 ? used / limit : 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  const barColor = level === 'over' ? 'bg-destructive' : level === 'warn' ? 'bg-amber-500' : 'bg-primary';
  const border =
    level === 'over' ? 'border-destructive/30 bg-destructive/5' : level === 'warn' ? 'border-amber-200 bg-amber-50' : '';

  return (
    <div className={`rounded-xl border p-4 ${border}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">今月のオンライン予約</span>
        <span className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{used.toLocaleString()}</span> / {limit.toLocaleString()} 件
          <span className="ml-2 text-xs">（{planName}）</span>
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {level === 'warn' && (
        <p className="mt-2 text-xs text-amber-800">
          上限に近づいています。超過するとオンライン予約の受付を停止する場合があります（店舗側からの登録は制限されません）。
        </p>
      )}
      {level === 'over' && (
        <p className="mt-2 text-xs text-destructive">
          今月の上限を超えています。上位プランへの変更をご検討ください。店舗側からの予約登録は引き続きご利用いただけます。
        </p>
      )}
    </div>
  );
}
