/**
 * 契約プランの利用量クォータ（予約件数）。
 *
 * 設計方針 — **顧客の予約を安易に止めない**:
 * 予約が取れない状態は商家にとって直接の営業損失であり、上限超過を理由に顧客をブロックすると
 * 「システムのせいで売上を失った」となって解約・悪評に直結する。そのため
 *   - 超過しても猶予帯（GRACE_RATIO）内は通す（警告のみ）
 *   - 止めるのは猶予も超えた場合の**オンライン予約のみ**。店舗側の後台からの登録は常に可能
 *   - 顧客向け文面に課金事情を書かない（電話予約へ誘導する）
 * とする。フリープラン（100件/月）ではこれが有料化の動線として機能する。
 */
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowUtc, monthStartInZone } from '@/lib/time';

/** 上限に対してこの倍率までは通す（例: 1.1 = 10% 超過まで猶予）。 */
const GRACE_RATIO = 1.1;
/** プラン未設定テナントの既定（フリー相当）。 */
const DEFAULT_MAX_BOOKINGS_PER_MONTH = 100;

export interface BookingQuotaUsage {
  /** 当月の予約作成数 */
  used: number;
  /** プランの上限 */
  limit: number;
  /** 使用率（0〜） */
  ratio: number;
  /** 上限超過しているか（猶予帯を含めて判定しない、純粋な超過） */
  exceeded: boolean;
  planName: string;
}

/**
 * 当月の開始時刻。店舗ローカル暦月（JST）で切る。
 * UTC暦月で切ると JST月初/月末の 9時間ズレでカウント対象月が1件単位でずれ、
 * 「月が変わったのに前月分が残る/月初なのに超過扱い」になる。
 */
function monthStart(now: Date): Date {
  return monthStartInZone(now);
}

/** テナントの当月予約数と上限。後台での可視化にも使う。 */
export async function getBookingQuotaUsage(tenantId: string, now: Date = nowUtc()): Promise<BookingQuotaUsage> {
  const [tenant, used] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { billingExempt: true, plan: { select: { maxBookingsPerMonth: true, name: true } } },
    }),
    prisma.booking.count({ where: { tenantId, createdAt: { gte: monthStart(now) } } }),
  ]);
  const limit = tenant?.plan?.maxBookingsPerMonth ?? DEFAULT_MAX_BOOKINGS_PER_MONTH;
  return {
    used,
    limit,
    ratio: limit > 0 ? used / limit : 0,
    exceeded: limit > 0 && used >= limit,
    planName: tenant?.plan?.name ?? 'フリー',
  };
}

/**
 * オンライン予約（顧客側）の受付可否を検査。猶予帯を超えている場合のみ拒否する。
 * 課金免除テナントは常に許可。後台からの予約登録では**呼ばない**こと。
 */
export async function assertPublicBookingQuota(tenantId: string, now: Date = nowUtc()): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingExempt: true, plan: { select: { maxBookingsPerMonth: true, name: true } } },
  });
  if (!tenant || tenant.billingExempt) return;
  const limit = tenant.plan?.maxBookingsPerMonth ?? DEFAULT_MAX_BOOKINGS_PER_MONTH;
  if (limit <= 0) return;

  const used = await prisma.booking.count({ where: { tenantId, createdAt: { gte: monthStart(now) } } });
  if (used < limit) return;

  if (used < Math.floor(limit * GRACE_RATIO)) {
    // 猶予帯: 通すが記録は残す（後台での警告表示・営業フォローの материал）
    logger.warn(
      { tenantId, used, limit, plan: tenant.plan?.name },
      '[quota] monthly booking limit exceeded (within grace, allowed)',
    );
    return;
  }

  logger.warn({ tenantId, used, limit }, '[quota] monthly booking limit exceeded → online booking blocked');
  // 顧客には課金事情を見せない。電話予約へ誘導する。
  throw Errors.conflict(
    'CONFLICT',
    '申し訳ございません。ただいまオンラインでのご予約を受け付けできません。お手数ですが店舗へ直接お問い合わせください。',
  );
}
