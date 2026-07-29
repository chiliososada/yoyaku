/**
 * 課金（Stripe サブスクリプション）のドメインロジック。
 * - evaluateBillingAccess: 商家後台へのアクセス可否（免除/契約中/トライアル/ロック）
 * - processStripeEvent: Webhook イベント → テナントの課金状態を同期（冪等）
 * - ensureStripeCustomer / startCheckout / openPortal: 申込・管理フロー
 *
 * ロールアウト安全策: Stripe 未設定（キー無し）の間はゲートは常に許可＝完全休眠。
 * 既存テナントは migration で billingExempt=true にバックフィル済み。
 */
import { prisma, Prisma } from '@/lib/db';
import type { BillingEventType } from '@prisma/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { nowUtc } from '@/lib/time';
import { Errors } from '@/lib/errors';
import {
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  isStripeConfigured,
  StripeApiError,
} from './stripe';

/** 新規テナントに付与するローカル無料トライアル日数。 */
export const BILLING_TRIAL_DAYS = 30;

/** アクセス判定に必要な最小限のテナント課金情報。 */
export interface TenantBillingInfo {
  billingExempt: boolean;
  stripeSubscriptionStatus: string | null;
  trialEndsAt: Date | null;
  /** 支払い済み期間の末日（Stripe の current_period_end）。解約後の猶予判定に使う。 */
  currentPeriodEnd: Date | null;
}

export type BillingState = 'DORMANT' | 'EXEMPT' | 'SUBSCRIBED' | 'TRIAL' | 'CANCELED_GRACE' | 'LOCKED';

export interface BillingGate {
  allowed: boolean;
  state: BillingState;
  /** TRIAL のとき残り日数（切り上げ、最小 0） */
  trialDaysLeft?: number;
  /** CANCELED_GRACE のとき、いつまで使えるか（＝支払い済み期間の末日） */
  accessUntil?: Date;
}

/** Stripe status のうち後台アクセスを許可するもの（past_due は督促中の猶予として許可）。 */
const ALLOWED_SUB_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * 契約が完全に終了していて、新規申込をやり直してよい status。
 * これ以外（NULL＝同期待ち / incomplete＝決済確定待ち を含む）で
 * サブスクIDが残っている場合は、二本目を作らせない。
 */
const DEAD_SUB_STATUSES = new Set(['canceled', 'incomplete_expired']);

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
  // 解約後の猶予: 支払い済み期間の末日までは使えると規約・特商法・LP で明示している
  // （「解約後も、お支払い済み期間の末日までご利用いただけます」）。Stripe Portal の
  // 既定は期末解約なのでこの分岐に入らないことも多いが、即時解約が有効な設定や
  // 期中の解約でもその約束を守れるよう、実装側で保証する。
  // incomplete_expired（＝一度も決済が完了していない）には猶予を与えない。
  if (
    tenant.stripeSubscriptionStatus === 'canceled' &&
    tenant.currentPeriodEnd &&
    tenant.currentPeriodEnd.getTime() > opts.now.getTime()
  ) {
    return { allowed: true, state: 'CANCELED_GRACE', accessUntil: tenant.currentPeriodEnd };
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
    select: { billingExempt: true, stripeSubscriptionStatus: true, trialEndsAt: true, currentPeriodEnd: true },
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

/**
 * ローカルトライアルの残日数（切り上げ）。Stripe へ引き継ぐ用。
 * 期限切れ・未設定なら 0（＝即時課金）。純関数（テスト容易性のため now を引数）。
 */
export function remainingTrialDays(trialEndsAt: Date | null, now: Date): number {
  if (!trialEndsAt) return 0;
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** プラン申込の Checkout URL を発行。 */
export async function startCheckout(tenantId: string, planId: string, email?: string | null): Promise<string> {
  // 二重申込（＝二重課金）の防止。
  //
  // status だけを見ると穴がある: この列を書くのは Webhook だけで、Checkout 完了から
  // customer.subscription.* が届くまで（Webhook 障害時は永久に）NULL のままになる。
  // その間に商家が「申し込む」をもう一度押すと Stripe は二本目の契約を作り、
  // テナント行は最後の1本しか保持しないため、一本目は誰にも気づかれず毎月課金され続ける。
  // そこで「サブスクIDが既にある」ことも拒否条件に含める。
  // 解約後の再契約は status='canceled' になるので、この条件をすり抜けて正しく通る。
  const current = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { stripeSubscriptionId: true, stripeSubscriptionStatus: true, trialEndsAt: true },
  });
  if (current?.stripeSubscriptionStatus && ALLOWED_SUB_STATUSES.has(current.stripeSubscriptionStatus)) {
    throw Errors.conflict('CONFLICT', '既にご契約中です。プラン変更・解約は「お支払い方法・解約の管理」から行えます。');
  }
  // サブスクIDが既にあり、かつ「完全に終了した」状態でないなら申込を止める。
  // status が NULL（同期待ち）でも 'incomplete'（決済確定待ち）でも二本目は作らせない。
  // 二重課金は取り返しがつかないが、一時的に申し込めないのは運営が Stripe 側で解消できる。
  if (current?.stripeSubscriptionId && !DEAD_SUB_STATUSES.has(current.stripeSubscriptionStatus ?? '')) {
    throw Errors.conflict(
      'CONFLICT',
      'お申し込みを処理中です。数十秒お待ちいただき、ページを再読み込みしてください。' +
        '重複してお申し込みいただく必要はありません（表示が変わらない場合はサポートへご連絡ください）。',
    );
  }
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { id: true, isActive: true, stripePriceId: true },
  });
  if (!plan || !plan.isActive || !plan.stripePriceId) {
    throw Errors.notFound('このプランは現在お申し込みいただけません。');
  }
  const base = env.APP_BASE_URL;
  // トライアル途中での申込でも残り日数を失わせない（Stripe 側にも同じ猶予を設定）
  const trialPeriodDays = remainingTrialDays(current?.trialEndsAt ?? null, nowUtc());
  const open = (customerId: string) =>
    createCheckoutSession({
      customerId,
      priceId: plan.stripePriceId!,
      tenantId,
      successUrl: `${base}/admin/billing?checkout=success`,
      cancelUrl: `${base}/admin/billing?checkout=canceled`,
      trialPeriodDays,
    });

  const customerId = await ensureStripeCustomer(tenantId, email);
  try {
    return (await open(customerId)).url;
  } catch (e) {
    // 保存済みの顧客IDが Stripe 側に存在しない場合の自己修復。
    // ensureStripeCustomer は保存値をそのまま返すだけで実在確認をしないため、
    // テスト→本番モードの切替・ダッシュボードでの顧客削除・古いバックアップからの復元
    // などで無効な ID が残ると、商家は「申し込む」を押す度に同じ失敗を繰り返し、
    // 二度と契約できない（最も痛い場面での静かな行き止まり）。作り直して1回だけ再試行する。
    if (!(e instanceof StripeApiError) || !e.isResourceMissing('customer')) throw e;
    logger.warn({ tenantId, staleCustomerId: customerId }, '[billing] stored Stripe customer is gone — recreating');
    await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: null } });
    const fresh = await ensureStripeCustomer(tenantId, email);
    return (await open(fresh)).url;
  }
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
// 課金イベント台帳（追記専用）
// ---------------------------------------------------------------------------

/**
 * 課金イベントを台帳へ追記。**この関数以外から billing_events を書かないこと。**
 *
 * - 金額・プラン名は「発生時点のスナップショット」。後から Plan.priceJpy を改定しても
 *   過去の MRR が書き換わらないようにするのが目的。
 * - stripeEventId で冪等。Webhook 再送で二重計上しない（P2002 は握りつぶす）。
 * - 記録失敗が課金同期そのものを壊さないよう、例外は投げずログのみ（台帳はベストエフォート）。
 */
async function recordBillingEvent(input: {
  tenantId: string;
  type: BillingEventType;
  planId?: string | null;
  amountJpy?: number | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  stripeEventId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeInvoiceId?: string | null;
  stripeChargeId?: string | null;
  stripeRefundId?: string | null;
  occurredAt: Date;
}): Promise<void> {
  try {
    // プランは「その時の姿」を保存（参照だと改名・削除で過去が変わる）
    let planCode: string | null = null;
    let planName: string | null = null;
    let amount = input.amountJpy ?? null;
    if (input.planId) {
      const plan = await prisma.plan.findUnique({
        where: { id: input.planId },
        select: { code: true, name: true, priceJpy: true },
      });
      if (plan) {
        planCode = plan.code;
        planName = plan.name;
        if (amount == null) amount = plan.priceJpy;
      }
    }
    await prisma.billingEvent.create({
      data: {
        tenantId: input.tenantId,
        type: input.type,
        planId: input.planId ?? null,
        planCode,
        planName,
        amountJpy: amount,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        stripeEventId: input.stripeEventId ?? null,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        stripeInvoiceId: input.stripeInvoiceId ?? null,
        stripeChargeId: input.stripeChargeId ?? null,
        stripeRefundId: input.stripeRefundId ?? null,
        occurredAt: input.occurredAt,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // 一意制約 = 記録済み。正常な二重計上防止:
      //   stripeEventId  … 同一 Webhook イベントの再送
      //   stripeRefundId … 同じ返金が別イベント／累計値の再通知として再来
      return;
    }
    logger.error(
      { tenantId: input.tenantId, type: input.type, err: e instanceof Error ? e.message : String(e) },
      '[billing] failed to record billing event (ledger write is best-effort)',
    );
  }
}

/** 新規テナントのトライアル開始を台帳に記録（コホート分析の起点）。 */
export async function recordTrialStarted(tenantId: string, planId: string | null, at: Date): Promise<void> {
  await recordBillingEvent({ tenantId, type: 'TRIAL_STARTED', planId, occurredAt: at });
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
  planId: string | null;
};

const TENANT_BILLING_SELECT = {
  id: true,
  stripeSubscriptionId: true,
  stripeSubscriptionStatus: true,
  lastStripeEventAt: true,
  planId: true,
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

/**
 * 「同じ秒」に届いたイベントによる状態の後退を防ぐ。
 *
 * Stripe の event.created は秒精度しかないため、subscription.created(incomplete) と
 * 直後の subscription.updated(active) が同一秒になることが実際にある。順序保証も無い。
 * isStaleEvent は strict `<` なので同秒イベントは素通りし、incomplete が後にコミットすると
 * 「支払い済みなのに LOCKED」という最悪の状態になる。
 * そこで、同秒以前のイベントがアクセス可能状態から不可状態へ引き戻す場合だけ拒否する。
 * （前進方向・厳密に新しいイベントは常に適用する）
 */
function isRegressiveSameSecondEvent(
  tenant: TenantBillingRow,
  eventAtMs: number | null,
  nextStatus: string,
): boolean {
  if (!eventAtMs || !tenant.lastStripeEventAt) return false;
  if (eventAtMs > tenant.lastStripeEventAt.getTime()) return false; // 厳密に新しい → 適用
  const currentlyAllowed = Boolean(
    tenant.stripeSubscriptionStatus && ALLOWED_SUB_STATUSES.has(tenant.stripeSubscriptionStatus),
  );
  const nextAllowed = ALLOWED_SUB_STATUSES.has(nextStatus);
  return currentlyAllowed && !nextAllowed;
}

async function syncSubscription(
  sub: StripeSubscriptionObject,
  deleted: boolean,
  eventAtMs: number | null,
  stripeEventId?: string | null,
  isCreateEvent = false,
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

  // 順序ガード③: 同一秒に届いたイベントで「利用可 → 利用不可」へ後退させない。
  // （created:incomplete と updated:active が同秒になり、incomplete が後勝ちすると
  //   支払い済みの商家がロックアウトされる。解約 deleted は上のガード②で別途担保済み）
  if (!deleted && isRegressiveSameSecondEvent(tenant, eventAtMs, status)) {
    logger.info(
      { tenantId: tenant.id, subscriptionId: sub.id, from: tenant.stripeSubscriptionStatus, to: status },
      '[billing] same-second regressive event skipped (would lock out a paying tenant)',
    );
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plan = priceId
    ? await prisma.plan.findFirst({ where: { stripePriceId: priceId }, select: { id: true } })
    : null;
  // 期間終了は API バージョンにより top-level または items 側（2025-03 Basil 以降）
  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;

  // 解約/復活をテナント状態にも反映する。これが無いと tenant.status は作成時 ACTIVE のまま
  // 一度も遷移せず、解約率が集計不能になる（認証には使われていないため副作用は無い）。
  const tenantStatus: 'ACTIVE' | 'CANCELLED' | undefined = deleted
    ? 'CANCELLED'
    : ALLOWED_SUB_STATUSES.has(status)
      ? 'ACTIVE'
      : undefined;

  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      stripeCustomerId: sub.customer || undefined,
      stripeSubscriptionId: sub.id,
      stripeSubscriptionStatus: status,
      // イベントが期間情報を含まないときは既知の値を保持する（null で潰さない）。
      // 解約イベントで潰すと「支払い済み期間の末日まで利用可」の猶予判定が効かなくなる。
      ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
      ...(plan ? { planId: plan.id } : {}),
      ...(tenantStatus ? { status: tenantStatus } : {}),
      ...(eventAtMs ? { lastStripeEventAt: new Date(eventAtMs) } : {}),
    },
  });

  // 契約履歴（Subscription）を externalRef=サブスクID（unique）で upsert。
  // これは「現在状態」のスナップショット。履歴そのものは billing_events 側が持つ。
  if (plan) {
    await prisma.subscription.upsert({
      where: { externalRef: sub.id },
      update: {
        status: toHistoryStatus(status),
        // アップグレードでプランが変わった場合に履歴行が旧プランのまま取り残されるのを防ぐ
        planId: plan.id,
        ...(deleted ? { expiresAt: nowUtc() } : {}),
      },
      create: {
        tenantId: tenant.id,
        planId: plan.id,
        externalRef: sub.id,
        status: toHistoryStatus(status),
        ...(deleted ? { expiresAt: nowUtc() } : {}),
      },
    });
  }

  // 追記専用の台帳へ。状態遷移・プラン変更を分類して残す（MRR/解約率の一次情報）。
  // 分類の権威は Stripe のイベント種別（created/updated/deleted）。
  // tenant.stripeSubscriptionStatus は checkout.session.completed が先に 'incomplete' を
  // 立てるため「初回か否か」の判定には使えず、trial の planId 差で planChanged が誤発火して
  // 初回契約が PLAN_CHANGED/UPDATED に化けていた。created イベントは定義上つねに新規契約。
  const planChanged = Boolean(plan && tenant.planId && plan.id !== tenant.planId);
  const eventType: BillingEventType = deleted
    ? 'SUBSCRIPTION_CANCELED'
    : isCreateEvent
      ? 'SUBSCRIPTION_CREATED'
      : planChanged
        ? 'PLAN_CHANGED'
        : 'SUBSCRIPTION_UPDATED';
  await recordBillingEvent({
    tenantId: tenant.id,
    type: eventType,
    planId: plan?.id ?? tenant.planId,
    fromStatus: tenant.stripeSubscriptionStatus,
    toStatus: status,
    stripeEventId: stripeEventId ?? null,
    stripeSubscriptionId: sub.id,
    occurredAt: eventAtMs ? new Date(eventAtMs) : nowUtc(),
  });

  // 解約確認メール（猶予期間の案内を含む）。同一イベントの再送では増えない。
  if (deleted && stripeEventId) {
    const { enqueueBillingNotice } = await import('@/server/services/billing-notification-service');
    await enqueueBillingNotice({
      tenantId: tenant.id,
      template: 'BILLING_SUBSCRIPTION_CANCELED',
      dedupeKey: `evt:${stripeEventId}`,
    }).catch((e) => logger.warn({ err: String(e) }, '[billing] cancel notice enqueue failed'));
  }

  logger.info({ tenantId: tenant.id, subscriptionId: sub.id, status }, '[billing] subscription synced');
}

/** charge.refunded の charge オブジェクト（必要な項目のみ）。 */
interface StripeChargeObject {
  id?: string;
  customer?: string;
  invoice?: string;
  /** その charge に対する返金の**累計**額（最小通貨単位）。単一返金の額ではない。 */
  amount_refunded?: number;
  refunds?: {
    has_more?: boolean;
    data?: Array<{ id?: string; amount?: number; status?: string; created?: number }>;
  };
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
      //
      // subscription.* が届く前でも二重申込ガードが効くよう、ここで暫定の状態も入れる。
      // 値は Checkout 完了時点の実態に最も近い 'incomplete'（＝まだ課金確定ではない）。
      // 直後に来る subscription.created/updated が正しい状態で上書きする。
      // 既に状態が入っている場合は触らない（後続イベントを巻き戻さないため）。
      await prisma.tenant.updateMany({
        where: { id: tenantId },
        data: {
          stripeCustomerId: s.customer,
          ...(s.subscription ? { stripeSubscriptionId: s.subscription } : {}),
        },
      });
      if (s.subscription) {
        await prisma.tenant.updateMany({
          where: { id: tenantId, stripeSubscriptionStatus: null },
          data: { stripeSubscriptionStatus: 'incomplete' },
        });
      }
      logger.info({ tenantId, customer: s.customer }, '[billing] checkout completed');
      return;
    }
    case 'customer.subscription.created':
      await syncSubscription(event.data.object as unknown as StripeSubscriptionObject, false, eventAtMs, event.id, true);
      return;
    case 'customer.subscription.updated':
      await syncSubscription(event.data.object as unknown as StripeSubscriptionObject, false, eventAtMs, event.id, false);
      return;
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object as unknown as StripeSubscriptionObject, true, eventAtMs, event.id);
      return;
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      // 実際に入金された金額の記録。契約状態は変えない（状態は subscription.* が正）。
      // これが無いと「請求したはず」しか残らず、実収の証跡が DB に一切残らない。
      const inv = event.data.object as {
        id?: string;
        customer?: string;
        subscription?: string;
        amount_paid?: number;
        currency?: string;
      };
      if (!inv.customer) return;
      const tenant = await prisma.tenant.findUnique({
        where: { stripeCustomerId: inv.customer },
        select: TENANT_BILLING_SELECT,
      });
      if (!tenant) return;
      await recordBillingEvent({
        tenantId: tenant.id,
        type: 'PAYMENT_SUCCEEDED',
        planId: tenant.planId,
        // Stripe の amount_paid は最小通貨単位。JPY は 0 桁通貨なのでそのまま円。
        amountJpy: typeof inv.amount_paid === 'number' ? inv.amount_paid : null,
        toStatus: tenant.stripeSubscriptionStatus,
        stripeEventId: event.id ?? null,
        stripeSubscriptionId: inv.subscription ?? tenant.stripeSubscriptionId,
        stripeInvoiceId: inv.id ?? null,
        occurredAt: eventAtMs ? new Date(eventAtMs) : nowUtc(),
      });
      // 督促後に支払いが通ったときだけ「復旧しました」を送る。
      // 通常の毎月の入金でいちいちメールを送ると鬱陶しいので past_due からの回復時に限定する。
      if (event.id && tenant.stripeSubscriptionStatus === 'past_due') {
        const { enqueueBillingNotice } = await import('@/server/services/billing-notification-service');
        await enqueueBillingNotice({
          tenantId: tenant.id,
          template: 'BILLING_PAYMENT_RECOVERED',
          dedupeKey: `evt:${event.id}`,
        }).catch((e) => logger.warn({ err: String(e) }, '[billing] recovery notice enqueue failed'));
      }
      logger.info({ tenantId: tenant.id, amount: inv.amount_paid }, '[billing] payment succeeded');
      return;
    }
    case 'charge.refunded': {
      // 返金は Stripe ダッシュボードから手動で行うことがあり、その痕跡が台帳に無いと
      // SUM(amountJpy) が実収入より過大になる（しかも無言で狂う）。負数で追記して相殺する。
      //
      // 二重計上の罠: charge.refunded は返金の度に発火し、charge.amount_refunded は**累計**。
      // 例) 3,000円 → 5,000円 と分割返金すると 3,000 / 8,000 と届く。累計をそのまま
      // 記録すると合計 -11,000（実際は -8,000）。よって**単一返金 id ごと**に記録する。
      const charge = event.data.object as StripeChargeObject;
      if (!charge.customer) return;
      const tenant = await prisma.tenant.findUnique({
        where: { stripeCustomerId: charge.customer },
        select: TENANT_BILLING_SELECT,
      });
      if (!tenant) {
        logger.warn({ charge: charge.id, customer: charge.customer }, '[billing] refund: tenant not found');
        return;
      }

      const refunds = charge.refunds?.data ?? [];
      if (charge.refunds?.has_more) {
        // 1件の charge に返金が大量にある稀ケース。取りこぼしは下の照合で検知される。
        logger.warn({ charge: charge.id }, '[billing] refund list paginated (has_more) — verify totals');
      }
      for (const r of refunds) {
        if (!r.id || typeof r.amount !== 'number') continue;
        // 実際に金銭が動いた返金のみ計上。pending/failed/canceled は計上しない
        // （failed を計上すると「返したのに返していない」逆方向のズレになる）。
        if (r.status && r.status !== 'succeeded') {
          logger.warn({ charge: charge.id, refund: r.id, status: r.status }, '[billing] refund not succeeded — not recorded');
          continue;
        }
        await recordBillingEvent({
          tenantId: tenant.id,
          type: 'PAYMENT_REFUNDED',
          planId: tenant.planId,
          // 負数で記録（JPY は 0 桁通貨なので最小単位＝円）
          amountJpy: -Math.abs(r.amount),
          toStatus: tenant.stripeSubscriptionStatus,
          stripeEventId: null, // 冪等キーは refund id 側で担保（1イベントに複数返金が載りうる）
          stripeSubscriptionId: tenant.stripeSubscriptionId,
          stripeInvoiceId: charge.invoice ?? null,
          stripeChargeId: charge.id ?? null,
          stripeRefundId: r.id,
          occurredAt: typeof r.created === 'number' ? new Date(r.created * 1000) : eventAtMs ? new Date(eventAtMs) : nowUtc(),
        });
      }

      // 照合: 台帳に載った返金合計と Stripe の累計が一致するか。ズレたら運用者が気づけるよう警告。
      if (typeof charge.amount_refunded === 'number' && charge.id) {
        const agg = await prisma.billingEvent.aggregate({
          where: { tenantId: tenant.id, type: 'PAYMENT_REFUNDED', stripeChargeId: charge.id },
          _sum: { amountJpy: true },
        });
        const ledger = Math.abs(agg._sum.amountJpy ?? 0);
        if (ledger !== charge.amount_refunded) {
          logger.warn(
            { tenantId: tenant.id, charge: charge.id, ledger, stripe: charge.amount_refunded },
            '[billing] refund total mismatch between ledger and Stripe',
          );
        }
      }
      logger.info({ tenantId: tenant.id, charge: charge.id, refunded: charge.amount_refunded }, '[billing] refund recorded');
      return;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object as { id?: string; customer?: string; subscription?: string };
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
      await recordBillingEvent({
        tenantId: tenant.id,
        type: 'PAYMENT_FAILED',
        planId: tenant.planId,
        fromStatus: tenant.stripeSubscriptionStatus,
        toStatus: 'past_due',
        stripeEventId: event.id ?? null,
        stripeSubscriptionId: inv.subscription ?? tenant.stripeSubscriptionId,
        stripeInvoiceId: inv.id ?? null,
        occurredAt: eventAtMs ? new Date(eventAtMs) : nowUtc(),
      });
      // 督促メール。dedupeKey に Stripe イベントIDを使うので、同一イベントの再送では増えない。
      // Stripe のリトライ（日単位）は別イベントになるため、そのつど督促が飛ぶ＝意図どおり。
      if (event.id) {
        const { enqueueBillingNotice } = await import('@/server/services/billing-notification-service');
        await enqueueBillingNotice({
          tenantId: tenant.id,
          template: 'BILLING_PAYMENT_FAILED',
          dedupeKey: `evt:${event.id}`,
        }).catch((e) => logger.warn({ err: String(e) }, '[billing] dunning notice enqueue failed'));
      }
      logger.warn({ tenantId: tenant.id }, '[billing] invoice payment failed → past_due');
      return;
    }
    default:
      // 監視対象外のイベントは無視（登録イベントを絞る想定だが防御的に）
      return;
  }
}
