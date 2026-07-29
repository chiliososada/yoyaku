/**
 * Stripe API クライアント（native fetch・SDK 非依存）。
 * - サブスクリプション Checkout / Billing Portal / 顧客作成 / Webhook 署名検証のみの薄いラッパ。
 * - STRIPE_SECRET_KEY 未設定なら isStripeConfigured()=false（課金機能は休眠、既存動線に無影響）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';

const API_BASE = 'https://api.stripe.com/v1';

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** ネスト対応の form-urlencoded 変換（line_items[0][price] 等）。 */
export function toFormBody(params: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object' && v !== null) parts.push(...toFormBody(v as Record<string, unknown>, `${name}[${i}]`));
        else parts.push(`${encodeURIComponent(`${name}[${i}]`)}=${encodeURIComponent(String(v))}`);
      });
    } else if (typeof value === 'object') {
      parts.push(...toFormBody(value as Record<string, unknown>, name));
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts;
}

async function stripePost<T>(
  path: string,
  params: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<T> {
  if (!isStripeConfigured()) throw Errors.conflict('STRIPE_NOT_CONFIGURED', '決済機能は準備中です。');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // 同一キーの再送は Stripe 側で最初の結果を返す＝オブジェクトが二重に作られない
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: toFormBody(params).join('&'),
  });
  const data = (await res.json()) as T & { error?: { message?: string; type?: string } };
  if (!res.ok) {
    const msg = data.error?.message ?? `Stripe API error (${res.status})`;
    throw new Error(`[stripe] ${path}: ${msg}`);
  }
  return data;
}

/** Stripe 顧客を作成（テナント単位・metadata に tenantId を刻む）。 */
export async function createStripeCustomer(input: {
  tenantId: string;
  name: string;
  email?: string | null;
}): Promise<{ id: string }> {
  return stripePost<{ id: string }>('/customers', {
    name: input.name,
    ...(input.email ? { email: input.email } : {}),
    metadata: { tenantId: input.tenantId },
  });
}

/** Stripe が受け付けるトライアル日数の範囲（1〜730日）。 */
const STRIPE_TRIAL_MIN_DAYS = 1;
const STRIPE_TRIAL_MAX_DAYS = 730;

/**
 * サブスクリプション Checkout セッションを作成し URL を返す。
 *
 * trialPeriodDays を渡すと Stripe 側でもトライアルが継続する。渡さないと
 * 「ローカル30日トライアルの3日目に申し込んだ商家が即時課金され、残り27日を失う」
 * という顧客不利益が起きるため、呼び出し側で必ず残日数を計算して渡すこと。
 */
export async function createCheckoutSession(input: {
  customerId: string;
  priceId: string;
  tenantId: string;
  successUrl: string;
  cancelUrl: string;
  trialPeriodDays?: number | null;
}): Promise<{ id: string; url: string }> {
  const trialDays =
    input.trialPeriodDays != null && Number.isFinite(input.trialPeriodDays)
      ? Math.min(STRIPE_TRIAL_MAX_DAYS, Math.floor(input.trialPeriodDays))
      : null;
  const subscriptionData: Record<string, unknown> = { metadata: { tenantId: input.tenantId } };
  if (trialDays != null && trialDays >= STRIPE_TRIAL_MIN_DAYS) {
    subscriptionData.trial_period_days = trialDays;
  }
  // 連打・二重送信の最終防衛線。テナント×プラン×時間バケット(10分)で冪等化する。
  // 時間バケットを入れるのは、後日ほんとうに再申込したい場合に永久ブロックしないため。
  const bucket = Math.floor(Date.now() / (10 * 60_000));
  const idempotencyKey = `checkout:${input.tenantId}:${input.priceId}:${bucket}`;
  return stripePost<{ id: string; url: string }>(
    '/checkout/sessions',
    {
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: 'true',
      metadata: { tenantId: input.tenantId },
      subscription_data: subscriptionData,
    },
    idempotencyKey,
  );
}

/** Billing Portal（カード変更・請求書・解約）のセッション URL。 */
export async function createBillingPortalSession(input: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return stripePost<{ url: string }>('/billing_portal/sessions', {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
}

/**
 * Webhook 署名検証（Stripe-Signature: t=...,v1=...）。
 * HMAC-SHA256(`${t}.${payload}`) を timingSafeEqual で比較。タイムスタンプ許容 5 分。
 */
export function verifyStripeSignature(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (!signatureHeader) return false;
  const parts = new Map<string, string[]>();
  for (const kv of signatureHeader.split(',')) {
    const [k, v] = kv.split('=', 2);
    if (!k || !v) continue;
    const arr = parts.get(k.trim()) ?? [];
    arr.push(v.trim());
    parts.set(k.trim(), arr);
  }
  const t = parts.get('t')?.[0];
  const sigs = parts.get('v1') ?? [];
  if (!t || sigs.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  const expBuf = Buffer.from(expected, 'utf8');
  return sigs.some((s) => {
    const got = Buffer.from(s, 'utf8');
    return got.length === expBuf.length && timingSafeEqual(got, expBuf);
  });
}
