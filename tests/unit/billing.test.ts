/**
 * 課金ゲート判定・Stripe 署名検証・form エンコードの単体テスト。
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { evaluateBillingAccess } from '@/server/billing/billing-service';
import { verifyStripeSignature, toFormBody } from '@/server/billing/stripe';

const NOW = new Date('2026-07-18T00:00:00.000Z');
const base = {
  billingExempt: false,
  stripeSubscriptionStatus: null as string | null,
  trialEndsAt: null as Date | null,
  currentPeriodEnd: null as Date | null,
};

describe('evaluateBillingAccess', () => {
  it('Stripe 未設定なら常に許可（休眠）', () => {
    expect(evaluateBillingAccess(base, { now: NOW, stripeConfigured: false })).toMatchObject({
      allowed: true,
      state: 'DORMANT',
    });
  });

  it('課金免除は常に許可', () => {
    expect(
      evaluateBillingAccess({ ...base, billingExempt: true }, { now: NOW, stripeConfigured: true }),
    ).toMatchObject({ allowed: true, state: 'EXEMPT' });
  });

  it.each(['active', 'trialing', 'past_due'])('契約 status=%s は許可', (status) => {
    expect(
      evaluateBillingAccess({ ...base, stripeSubscriptionStatus: status }, { now: NOW, stripeConfigured: true }),
    ).toMatchObject({ allowed: true, state: 'SUBSCRIBED' });
  });

  it.each(['canceled', 'unpaid', 'incomplete_expired'])('契約 status=%s はトライアル無しでロック', (status) => {
    expect(
      evaluateBillingAccess({ ...base, stripeSubscriptionStatus: status }, { now: NOW, stripeConfigured: true }),
    ).toMatchObject({ allowed: false, state: 'LOCKED' });
  });

  it('トライアル期間内は許可・残り日数を返す', () => {
    const g = evaluateBillingAccess(
      { ...base, trialEndsAt: new Date(NOW.getTime() + 5.5 * 86_400_000) },
      { now: NOW, stripeConfigured: true },
    );
    expect(g).toMatchObject({ allowed: true, state: 'TRIAL', trialDaysLeft: 6 });
  });

  it('トライアル期限切れ・未契約はロック', () => {
    expect(
      evaluateBillingAccess(
        { ...base, trialEndsAt: new Date(NOW.getTime() - 1000) },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: false, state: 'LOCKED' });
  });

  it('解約済みでもトライアルが残っていれば許可（再契約猶予）', () => {
    expect(
      evaluateBillingAccess(
        {
          ...base,
          stripeSubscriptionStatus: 'canceled',
          trialEndsAt: new Date(NOW.getTime() + 86_400_000),
        },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: true, state: 'TRIAL' });
  });
});

/**
 * 「解約後も、お支払い済み期間の末日までご利用いただけます」— LP・利用規約・特商法表記で
 * 明示している約束。Stripe Portal が期末解約でなく即時解約になっても守れるよう、
 * 実装側で保証する（表示と実装の食い違いを作らない）。
 */
describe('解約後の猶予（支払い済み期間の末日まで）', () => {
  const periodEnd = new Date(NOW.getTime() + 12 * 86_400_000);

  it('解約済みでも期間末日前なら許可し、いつまで使えるかを返す', () => {
    const g = evaluateBillingAccess(
      { ...base, stripeSubscriptionStatus: 'canceled', currentPeriodEnd: periodEnd },
      { now: NOW, stripeConfigured: true },
    );
    expect(g).toMatchObject({ allowed: true, state: 'CANCELED_GRACE' });
    expect(g.accessUntil?.toISOString()).toBe(periodEnd.toISOString());
  });

  it('期間末日を過ぎたらロック', () => {
    expect(
      evaluateBillingAccess(
        { ...base, stripeSubscriptionStatus: 'canceled', currentPeriodEnd: new Date(NOW.getTime() - 1000) },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: false, state: 'LOCKED' });
  });

  it('期間末日が不明（null）ならロック', () => {
    expect(
      evaluateBillingAccess(
        { ...base, stripeSubscriptionStatus: 'canceled', currentPeriodEnd: null },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: false, state: 'LOCKED' });
  });

  it('一度も決済が完了していない incomplete_expired には猶予を与えない', () => {
    expect(
      evaluateBillingAccess(
        { ...base, stripeSubscriptionStatus: 'incomplete_expired', currentPeriodEnd: periodEnd },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: false, state: 'LOCKED' });
  });

  it('契約中（active）は期間末日があっても SUBSCRIBED のまま', () => {
    expect(
      evaluateBillingAccess(
        { ...base, stripeSubscriptionStatus: 'active', currentPeriodEnd: periodEnd },
        { now: NOW, stripeConfigured: true },
      ),
    ).toMatchObject({ allowed: true, state: 'SUBSCRIBED' });
  });
});

describe('verifyStripeSignature', () => {
  const SECRET = 'whsec_test_secret';
  const sign = (payload: string, ts: number) =>
    createHmac('sha256', SECRET).update(`${ts}.${payload}`, 'utf8').digest('hex');

  it('正しい署名は通る', () => {
    const payload = '{"type":"invoice.paid"}';
    const ts = Math.floor(NOW.getTime() / 1000);
    const header = `t=${ts},v1=${sign(payload, ts)}`;
    expect(verifyStripeSignature(payload, header, SECRET, NOW.getTime())).toBe(true);
  });

  it('改竄された payload は拒否', () => {
    const ts = Math.floor(NOW.getTime() / 1000);
    const header = `t=${ts},v1=${sign('{"a":1}', ts)}`;
    expect(verifyStripeSignature('{"a":2}', header, SECRET, NOW.getTime())).toBe(false);
  });

  it('タイムスタンプが 5 分超過は拒否（リプレイ防止）', () => {
    const payload = '{}';
    const ts = Math.floor(NOW.getTime() / 1000) - 301;
    const header = `t=${ts},v1=${sign(payload, ts)}`;
    expect(verifyStripeSignature(payload, header, SECRET, NOW.getTime())).toBe(false);
  });

  it('ヘッダ無し・別鍵は拒否', () => {
    const payload = '{}';
    const ts = Math.floor(NOW.getTime() / 1000);
    expect(verifyStripeSignature(payload, null, SECRET, NOW.getTime())).toBe(false);
    const other = createHmac('sha256', 'whsec_other').update(`${ts}.${payload}`).digest('hex');
    expect(verifyStripeSignature(payload, `t=${ts},v1=${other}`, SECRET, NOW.getTime())).toBe(false);
  });

  it('複数 v1（鍵ローテーション）はどれか一致で通る', () => {
    const payload = '{}';
    const ts = Math.floor(NOW.getTime() / 1000);
    const header = `t=${ts},v1=deadbeef,v1=${sign(payload, ts)}`;
    expect(verifyStripeSignature(payload, header, SECRET, NOW.getTime())).toBe(true);
  });
});

describe('toFormBody', () => {
  it('ネスト・配列を Stripe 形式にエンコードする', () => {
    const parts = toFormBody({
      mode: 'subscription',
      line_items: [{ price: 'price_x', quantity: 1 }],
      metadata: { tenantId: 't1' },
    });
    expect(parts).toContain('mode=subscription');
    expect(parts).toContain(`${encodeURIComponent('line_items[0][price]')}=price_x`);
    expect(parts).toContain(`${encodeURIComponent('line_items[0][quantity]')}=1`);
    expect(parts).toContain(`${encodeURIComponent('metadata[tenantId]')}=t1`);
  });
});
