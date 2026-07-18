/**
 * 課金（Stripe サブスクリプション）のドメインロジック。
 * - evaluateBillingAccess: 商家後台へのアクセス可否（免除/契約中/トライアル/ロック）
 * - processStripeEvent: Webhook イベント → テナントの課金状態を同期（冪等）
 * - ensureStripeCustomer / startCheckout / openPortal: 申込・管理フロー
 *
 * ロールアウト安全策: Stripe 未設定（キー無し）の間はゲートは常に許可＝完全休眠。
 * 既存テナントは migration で billingExempt=true にバックフィル済み。
 */
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { nowUtc } from '@/lib/time';
import { Errors } from '@/lib/errors';
import {
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  isStripeConfigured,
} from './stripe';

/** 新規テナントに付与するローカル無料トライアル日数。 */
export const BILLING_TRIAL_DAYS = 30;

/** アクセス判定に必要な最小限のテナント課金情報。 */
export interface TenantBillingInfo {
  billingExempt: boolean;
  stripeSubscriptionStatus: string | null;
  trialEndsAt: Date | null;
}

export type BillingState = 'DORMANT' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'LOCKED';

export interface BillingGate {
  allowed: boolean;
  state: BillingState;
  /** TRIAL のとき残り日数（切り上げ、最小 0） */
  trialDaysLeft?: number;
}

/** Stripe status のうち後台アクセスを許可するもの（past_due は督促中の猶予として許可）。 */
const ALLOWED_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * 商家後台のアクセス可否。純関数（テスト容易性のため設定・現在時刻は引数）。
 */
export function evaluateBillingAccess(
  tenant: TenantBillingInfo,
  opts: { now: Date; stripeConfigured: boolean },
): BillingGate {
  if (!opts.stripeConfigured) return { allowed: true, state: 'DORMANT' };
  if (tenant.billingExempt) return { allowed: true, state: 'EXEMPT' };
  if (tenant.stripeSubscriptionStatus && ALLOWED_SUB_STATUSES.has(tenant.stripeSubscriptionStatus)) {
    return { allowed: true, state: 'SUBSCRIBED' };
  }
  if (tenant.trialEndsAt && tenant.trialEndsAt.getTime() > opts.now.getTime()) {
    const daysLeft = Math.max(0, Math.ceil((tenant.trialEndsAt.getTime() - opts.now.getTime()) / 86_400_000));
    return { allowed: true, state: 'TRIAL', trialDaysLeft: daysLeft };
  }
  return { allowed: false, state: 'LOCKED' };
}

/** テナントの課金ゲートを DB から評価。 */
export async function loadBillingGate(tenantId: string): Promise<BillingGate> {
  if (!isStripeConfigured()) return { allowed: true, state: 'DORMANT' };
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingExempt: true, stripeSubscriptionStatus: true, trialEndsAt: true },
  });
  if (!t) return { allowed: false, state: 'LOCKED' };
  return evaluateBillingAccess(t, { now: nowUtc(), stripeConfigured: true });
}

/** Stripe 顧客IDを確保（未作成なら作成して保存）。 */
export async function ensureStripeCustomer(tenantId: string, email?: string | null): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, stripeCustomerId: true },
  });
  if (!tenant) throw Errors.notFound('テナントが見つかりません。');
  if (tenant.stripeCustomerId) return tenant.stripeCustomerId;
  const customer = await createStripeCustomer({ tenantId, name: tenant.name, email });
  // 同時実行で先に別の顧客IDが保存されていたらそれを正とする（重複顧客への契約分裂を防ぐ）
  const claimed = await prisma.tenant.updateMany({
    where: { id: tenantId, stripeCustomerId: null },
    data: { stripeCustomerId: customer.id },
  });
  if (claimed.count === 0) {
    const winner = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { stripeCustomerId: true } });
    if (winner?.stripeCustomerId) return winner.stripeCustomerId;
  }
  return customer.id;
}

/** プラン申込の Checkout URL を発行。 */
export async function startCheckout(tenantId: string, planId: string, email?: string | null): Promise<string> {
  // 既契約の二重申込（二重課金）を防止
  const current = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeSubscriptionStatus: true },
  });
  if (current?.stripeSubscriptionStatus && ALLOWED_SUB_STATUSES.has(current.stripeSubscriptionStatus)) {
    throw Errors.conflict('CONFLICT', '既にご契約中です。プラン変更・解約は「お支払い方法・解約の管理」から行えます。');
  }
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { id: true, isActive: true, stripePriceId: true },
  });
  if (!plan || !plan.isActive || !plan.stripePriceId) {
    throw Errors.notFound('このプランは現在お申し込みいただけません。');
  }
  const customerId = await ensureStripeCustomer(tenantId, email);
  const base = env.APP_BASE_URL;
  const session = await createCheckoutSession({
    customerId,
    priceId: plan.stripePriceId,
    tenantId,
    successUrl: `${base}/admin/billing?checkout=success`,
    cancelUrl: `${base}/admin/billing?checkout=canceled`,
  });
  return session.url;
}

/** Billing Portal（カード変更・解約等）の URL を発行。 */
export async function openPortal(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeCustomerId: true },
  });
  if (!tenant?.stripeCustomerId) throw Errors.notFound('お支払い情報がまだ登録されていません。');
  const session = await createBillingPortalSession({
    customerId: tenant.stripeCustomerId,
    returnUrl: `${env.APP_BASE_URL}/admin/billing`,
  });
  return session.url;
}

// ---------------------------------------------------------------------------
// Webhook イベント同期
// ---------------------------------------------------------------------------

interface StripeSubscriptionObject {
  id: string;
  customer: string;
  status: string;
  current_period_end?: number;
  metadata?: Record<string, string>;
  /// 新しめの Stripe API（2025-03 Basil 以降）は period が items 側に移動している
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
}

/** SubscriptionStatus enum（履歴テーブル用）への写像。未知の値は PAST_DUE 扱いで安全側。 */
function toHistoryStatus(stripeStatus: string): 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIALING' {
  switch (stripeStatus) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELLED';
    default:
      return 'PAST_DUE';
  }
}

type TenantBillingRow = {
  id: string;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  lastStripeEventAt: Date | null;
};

const TENANT_BILLING_SELECT = {
  id: true,
  stripeSubscriptionId: true,
  stripeSubscriptionStatus: true,
  lastStripeEventAt: true,
} as const;

async function findTenantForSubscription(sub: StripeSubscriptionObject): Promise<TenantBillingRow | null> {
  if (sub.metadata?.tenantId) {
    const byMeta = await prisma.tenant.findUnique({
      where: { id: sub.metadata.tenantId },
      select: TENANT_BILLING_SELECT,
    });
    if (byMeta) return byMeta;
  }
  if (sub.customer) {
    return prisma.tenant.findUnique({
      where: { stripeCustomerId: sub.customer },
      select: TENANT_BILLING_SELECT,
    });
  }
  return null;
}

/** 遅延再送された古いイベントか（番兵 lastStripeEventAt との比較）。 */
function isStaleEvent(tenant: TenantBillingRow, eventAtMs: number | null): boolean {
  return Boolean(eventAtMs && tenant.lastStripeEventAt && eventAtMs < tenant.lastStripeEventAt.getTime());
}

async function syncSubscription(
  sub: StripeSubscriptionObject,
  deleted: boolean,
  eventAtMs: number | null,
): Promise<void> {
  const tenant = await findTenantForSubscription(sub);
  if (!tenant) {
    logger.warn({ subscriptionId: sub.id, customer: sub.customer }, '[billing] subscription event: tenant not found');
    return;
  }
  // 順序ガード①: 番兵より古いイベントは適用しない（再送で新しい状態を巻き戻さない）
  if (isStaleEvent(tenant, eventAtMs)) {
    logger.info({ tenantId: tenant.id, subscriptionId: sub.id }, '[billing] stale event skipped');
    return;
  }
  // 順序ガード②: 「削除」は現在紐付いているサブスクに対するときのみ適用。
  // 解約→再契約後に旧サブスクの deleted が遅れて届いても、支払中のテナントをロックしない。
  if (deleted && tenant.stripeSubscriptionId && tenant.stripeSubscriptionId !== sub.id) {
    logger.info(
      { tenantId: tenant.id, deletedSub: sub.id, currentSub: tenant.stripeSubscriptionId },
      '[billing] deleted event for superseded subscription ignored',
    );
    return;
  }

  const status = deleted ? 'canceled' : sub.status;
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan = priceId
    ? await prisma.plan.findFirst({ where: { stripePriceId: priceId }, select: { id: true } })
    : null;
  // 期間終了は API バージョンにより top-level または items 側（2025-03 Basil 以降）
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeCustomerId: sub.customer || undefined,
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      ...(plan ? { planId: plan.id } : {}),
      ...(eventAtMs ? { lastStripeEventAt: new Date(eventAtMs) } : {}),
    },
  });

  // 契約履歴（Subscription）を externalRef=サブスクID（unique）で upsert
  if (plan) {
    await prisma.subscription.upsert({
      where: { externalRef: sub.id },
      update: { status: toHistoryStatus(status), ...(deleted ? { expiresAt: nowUtc() } : {}) },
      create: {
        tenantId: tenant.id,
        planId: plan.id,
        externalRef: sub.id,
        status: toHistoryStatus(status),
        ...(deleted ? { expiresAt: nowUtc() } : {}),
      },
    });
  }
  logger.info({ tenantId: tenant.id, subscriptionId: sub.id, status }, '[billing] subscription synced');
}

interface StripeEvent {
  id?: string;
  type: string;
  /// イベント発生時刻（unix 秒）。順序ガードに使用
  created?: number;
  data: { object: Record<string, unknown> };
}

/**
 * Webhook イベントの同期処理。冪等（同一イベント再送で結果が変わらない）かつ
 * 順序耐性（遅延再送された古いイベントで状態を巻き戻さない）。
 * 未知のイベントは無視して正常終了。
 */
export async function processStripeEvent(event: StripeEvent): Promise<void> {
  const eventAtMs = typeof event.created === 'number' && Number.isFinite(event.created)
    ? event.created * 1000
    : null;
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as {
        customer?: string;
        subscription?: string;
        metadata?: Record<string, string>;
      };
      const tenantId = s.metadata?.tenantId;
      if (!tenantId || !s.customer) return;
      // updateMany: テナントが消えていても throw せず無視（500 → Stripe の数日リトライを避ける）
      await prisma.tenant.updateMany({
        where: { id: tenantId },
        data: {
          stripeCustomerId: s.customer,
          ...(s.subscription ? { stripeSubscriptionId: s.subscription } : {}),
        },
      });
      logger.info({ tenantId, customer: s.customer }, '[billing] checkout completed');
      return;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await syncSubscription(event.data.object as unknown as StripeSubscriptionObject, false, eventAtMs);
      return;
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object as unknown as StripeSubscriptionObject, true, eventAtMs);
      return;
    case 'invoice.payment_failed': {
      const inv = event.data.object as { customer?: string };
      if (!inv.customer) return;
      const tenant = await prisma.tenant.findUnique({
        where: { stripeCustomerId: inv.customer },
        select: TENANT_BILLING_SELECT,
      });
      if (!tenant) return;
      if (isStaleEvent(tenant, eventAtMs)) return;
      // past_due はアクセス許可ステータスのため、現に利用中（active/trialing/past_due）の
      // テナントにのみ適用。canceled/未契約を「復活」させない。
      if (!tenant.stripeSubscriptionStatus || !ALLOWED_SUB_STATUSES.has(tenant.stripeSubscriptionStatus)) {
        return;
      }
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          stripeSubscriptionStatus: 'past_due',
          ...(eventAtMs ? { lastStripeEventAt: new Date(eventAtMs) } : {}),
        },
      });
      logger.warn({ tenantId: tenant.id }, '[billing] invoice payment failed → past_due');
      return;
    }
    default:
      // 監視対象外のイベントは無視（登録イベントを絞る想定だが防御的に）
      return;
  }
}
