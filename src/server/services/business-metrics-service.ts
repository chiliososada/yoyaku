/**
 * 経営指標（プラットフォーム管理者専用）。買収デューデリで説明できることを要件とする。
 *
 * ## 設計上の約束
 *
 * 1. **数字を作らない**。母数が0・履歴が足りない指標は `null` を返し、画面は「データ不足」を出す。
 *    LTV や解約率を根拠なく表示するのは、DD で最も信用を失う。
 * 2. **過去の金額は BillingEvent の金額スナップショットだけを使う**。
 *    現在の `Plan.priceJpy` から遡って計算すると、値上げした瞬間に過去のMRRが書き換わる。
 * 3. **`billingExempt=true` は全ての商業指標から除外**（自社・デモが売上に混ざらない）。
 * 4. 月境界は **JST 暦月**（`monthStartInZone`）。UTCで切ると月初/月末が9時間ずれる。
 *
 * ## 各指標の定義
 *
 * - **現在MRR** = 契約中テナントの `plan.priceJpy` 合計。
 *   契約中 = `billingExempt=false` かつ `stripeSubscriptionStatus ∈ {active, past_due}`。
 *   `trialing` は**含めない**（まだ入金が発生していないため）。`past_due` は含める
 *   （契約は継続しており督促中なだけ）。→ 前向きの「今の月次収益力」。
 *
 * - **実収推移（月次）** = 各JST暦月の `PAYMENT_SUCCEEDED + PAYMENT_REFUNDED` の金額合計。
 *   返金は負数で記録されているため素直に加算するだけで純額になる。
 *   これは「実際に動いた現金」であり台帳から厳密に再現できる。**MRRの履歴ではない**
 *   （過去の契約状態の復元は誤差が出るため、あえて実収で示す）。
 *
 * - **有料顧客数** = 現在MRRの母集団の件数。
 * - **新規契約数（期間）** = 期間内の `SUBSCRIPTION_CREATED` のユニークテナント数。
 * - **解約数（期間）** = 期間内の `SUBSCRIPTION_CANCELED` のユニークテナント数。
 * - **顧客解約率（期間）** = 解約数 ÷ 期間開始時点の有料顧客数。
 *   期間開始時点の有料顧客数は「その時点までに CREATED があり、まだ CANCELED が無い」テナント数で近似する。
 *   母数0なら `null`（0除算で無限やNaNを出さない）。
 * - **トライアル→有料転換率** = `TRIAL_STARTED` があったテナントのうち、後に `SUBSCRIPTION_CREATED`
 *   に到達した割合。母数0なら `null`。
 * - **平均継続月数** = 解約済みテナントの (CANCELED時刻 − CREATED時刻) の平均。
 *   解約実績が1件も無ければ `null`（＝まだ測れない）。
 * - **LTV** = 平均月次単価 × 平均継続月数。平均継続月数が `null` なら LTV も `null`。
 *   「churnから逆算した理論値」は履歴が薄い段階では誤差が大きいため採用しない。
 */
import { prisma } from '@/lib/db';
import { nowUtc, monthStartInZone, formatInTz } from '@/lib/time';

/** MRR に計上する Stripe status（trialing は未入金なので除外）。 */
const PAYING_STATUSES = ['active', 'past_due'] as const;

/**
 * 直近 count ヶ月の JST 'YYYY-MM' を古い順で返す。
 * 日数の引き算ではなく暦月を辿る（30日×12 では約360日で1ヶ月足りず、枠が欠ける）。
 */
function recentJstMonths(now: Date, count: number): string[] {
  const cur = formatInTz(now, 'yyyy-MM', 'Asia/Tokyo');
  let [y, m] = cur.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out.reverse();
}

export interface MonthlyRevenuePoint {
  /** 'YYYY-MM'（JST） */
  month: string;
  /** 実収（入金 − 返金）。円 */
  netJpy: number;
  paymentCount: number;
}

export interface BusinessMetrics {
  generatedAt: Date;
  /** 現在の月次収益力（円）。母集団が0なら 0 */
  currentMrrJpy: number;
  payingCustomers: number;
  trialingTenants: number;
  pastDueTenants: number;
  canceledTenants: number;
  /** 課金免除（自社・デモ）。指標からは除外しているが、内訳として見せる */
  exemptTenants: number;
  /** 直近12ヶ月の実収。データが無い月は 0 で埋める */
  monthlyRevenue: MonthlyRevenuePoint[];
  planDistribution: Array<{ planName: string; priceJpy: number; customers: number; mrrJpy: number }>;
  /** 期間指標（直近30日） */
  newSubscriptions30d: number;
  churned30d: number;
  /** 解約率。母数0なら null（＝データ不足） */
  churnRate30d: number | null;
  /** トライアル→有料の転換率。母数0なら null */
  trialConversionRate: number | null;
  trialStartedTotal: number;
  convertedTotal: number;
  /** 平均継続月数。解約実績0件なら null */
  avgLifetimeMonths: number | null;
  /** LTV（円）。avgLifetimeMonths が null なら null */
  ltvJpy: number | null;
  /** 台帳の最古イベント。履歴の厚みを画面で正直に示すため */
  ledgerSince: Date | null;
}

export async function getBusinessMetrics(now: Date = nowUtc()): Promise<BusinessMetrics> {
  // ---- 現在のテナント状態（商業指標は billingExempt=false のみ）----
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      billingExempt: true,
      stripeSubscriptionStatus: true,
      trialEndsAt: true,
      plan: { select: { name: true, priceJpy: true } },
    },
  });

  const billable = tenants.filter((t) => !t.billingExempt);
  const paying = billable.filter(
    (t) => t.stripeSubscriptionStatus && (PAYING_STATUSES as readonly string[]).includes(t.stripeSubscriptionStatus),
  );
  const currentMrrJpy = paying.reduce((s, t) => s + (t.plan?.priceJpy ?? 0), 0);

  // プラン別内訳
  const byPlan = new Map<string, { planName: string; priceJpy: number; customers: number; mrrJpy: number }>();
  for (const t of paying) {
    const key = t.plan?.name ?? '(プラン未設定)';
    const price = t.plan?.priceJpy ?? 0;
    const cur = byPlan.get(key) ?? { planName: key, priceJpy: price, customers: 0, mrrJpy: 0 };
    cur.customers += 1;
    cur.mrrJpy += price;
    byPlan.set(key, cur);
  }

  // ---- 実収推移（台帳の金額スナップショットのみ）----
  const since12 = monthStartInZone(new Date(now.getTime() - 365 * 86_400_000));
  const cashEvents = await prisma.billingEvent.findMany({
    where: {
      type: { in: ['PAYMENT_SUCCEEDED', 'PAYMENT_REFUNDED'] },
      occurredAt: { gte: since12 },
      tenant: { billingExempt: false },
    },
    select: { amountJpy: true, occurredAt: true, type: true },
  });
  const monthMap = new Map<string, MonthlyRevenuePoint>();
  // 直近12ヶ月の枠を先に作る（データが無い月も 0 として並べる）。
  // **暦月で数える**こと: 30日ずつ引くと12回で約360日にしかならず、
  // 同じ月が重複して枠が10〜11ヶ月に縮む（グラフの月が欠ける）。
  for (const m of recentJstMonths(now, 12)) {
    monthMap.set(m, { month: m, netJpy: 0, paymentCount: 0 });
  }
  for (const e of cashEvents) {
    const m = formatInTz(e.occurredAt, 'yyyy-MM', 'Asia/Tokyo');
    const cur = monthMap.get(m) ?? { month: m, netJpy: 0, paymentCount: 0 };
    cur.netJpy += e.amountJpy ?? 0;
    if (e.type === 'PAYMENT_SUCCEEDED') cur.paymentCount += 1;
    monthMap.set(m, cur);
  }
  const monthlyRevenue = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  // ---- 期間指標（直近30日）----
  const from30 = new Date(now.getTime() - 30 * 86_400_000);
  const [created30, canceled30] = await Promise.all([
    prisma.billingEvent.findMany({
      where: { type: 'SUBSCRIPTION_CREATED', occurredAt: { gte: from30 }, tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
    prisma.billingEvent.findMany({
      where: { type: 'SUBSCRIPTION_CANCELED', occurredAt: { gte: from30 }, tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
  ]);

  // 期間開始時点の有料顧客数 = その時点までに CREATED があり、まだ CANCELED が無いテナント
  const [createdBefore, canceledBefore] = await Promise.all([
    prisma.billingEvent.findMany({
      where: { type: 'SUBSCRIPTION_CREATED', occurredAt: { lt: from30 }, tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
    prisma.billingEvent.findMany({
      where: { type: 'SUBSCRIPTION_CANCELED', occurredAt: { lt: from30 }, tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
  ]);
  const canceledSet = new Set(canceledBefore.map((c) => c.tenantId));
  const payingAtStart = createdBefore.filter((c) => !canceledSet.has(c.tenantId)).length;
  const churnRate30d = payingAtStart > 0 ? canceled30.length / payingAtStart : null;

  // ---- トライアル→有料の転換 ----
  const [trialStarted, converted] = await Promise.all([
    prisma.billingEvent.findMany({
      where: { type: 'TRIAL_STARTED', tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
    prisma.billingEvent.findMany({
      where: { type: 'SUBSCRIPTION_CREATED', tenant: { billingExempt: false } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    }),
  ]);
  const convertedSet = new Set(converted.map((c) => c.tenantId));
  const convertedFromTrial = trialStarted.filter((t) => convertedSet.has(t.tenantId)).length;
  const trialConversionRate = trialStarted.length > 0 ? convertedFromTrial / trialStarted.length : null;

  // ---- 平均継続月数 / LTV（解約実績が無ければ測らない）----
  const lifetimes = await computeLifetimeMonths();
  const avgLifetimeMonths =
    lifetimes.length > 0 ? lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length : null;
  const avgMonthlyPrice = paying.length > 0 ? currentMrrJpy / paying.length : 0;
  const ltvJpy = avgLifetimeMonths != null && avgMonthlyPrice > 0
    ? Math.round(avgMonthlyPrice * avgLifetimeMonths)
    : null;

  const oldest = await prisma.billingEvent.findFirst({
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  });

  return {
    generatedAt: now,
    currentMrrJpy,
    payingCustomers: paying.length,
    trialingTenants: billable.filter(
      (t) => !t.stripeSubscriptionStatus && t.trialEndsAt && t.trialEndsAt.getTime() > now.getTime(),
    ).length,
    pastDueTenants: billable.filter((t) => t.stripeSubscriptionStatus === 'past_due').length,
    canceledTenants: billable.filter((t) => t.stripeSubscriptionStatus === 'canceled').length,
    exemptTenants: tenants.filter((t) => t.billingExempt).length,
    monthlyRevenue,
    planDistribution: [...byPlan.values()].sort((a, b) => b.mrrJpy - a.mrrJpy),
    newSubscriptions30d: created30.length,
    churned30d: canceled30.length,
    churnRate30d,
    trialConversionRate,
    trialStartedTotal: trialStarted.length,
    convertedTotal: convertedFromTrial,
    avgLifetimeMonths,
    ltvJpy,
    ledgerSince: oldest?.occurredAt ?? null,
  };
}

/**
 * 解約済みテナントごとの継続月数。
 * 「初回 CREATED」から「最後の CANCELED」までを1件として数える（再契約は1つの寿命として扱う）。
 */
async function computeLifetimeMonths(): Promise<number[]> {
  const events = await prisma.billingEvent.findMany({
    where: {
      type: { in: ['SUBSCRIPTION_CREATED', 'SUBSCRIPTION_CANCELED'] },
      tenant: { billingExempt: false },
    },
    select: { tenantId: true, type: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  });
  const first = new Map<string, Date>();
  const last = new Map<string, Date>();
  for (const e of events) {
    if (e.type === 'SUBSCRIPTION_CREATED' && !first.has(e.tenantId)) first.set(e.tenantId, e.occurredAt);
    if (e.type === 'SUBSCRIPTION_CANCELED') last.set(e.tenantId, e.occurredAt);
  }
  const out: number[] = [];
  for (const [tenantId, canceledAt] of last) {
    const createdAt = first.get(tenantId);
    if (!createdAt) continue; // 解約だけあって契約が無いのは異常データ → 数えない
    const months = (canceledAt.getTime() - createdAt.getTime()) / (30 * 86_400_000);
    if (months >= 0) out.push(months);
  }
  return out;
}
