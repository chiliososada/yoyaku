/**
 * 予約ルールの解決と判定（純粋関数）。
 * - 複数スコープ(SHOP/SERVICE/STAFF)の容量ルールを統合
 * - 受付期間(window)・締切(lead time)・キャンセル期限の判定
 */
import { differenceInCalendarDays } from 'date-fns';
import type { ResolvedBookingRules } from './types';

const MS_PER_HOUR = 3_600_000;

export interface CapacityRuleInput {
  scope: 'SHOP' | 'SERVICE' | 'STAFF';
  maxConcurrent: number;
  slotIntervalMin: number;
  bookingWindowDays: number;
  leadTimeMinHours: number;
  cancellationDeadlineHours: number;
}

export const DEFAULT_RULES: ResolvedBookingRules = {
  slotIntervalMin: 15,
  bookingWindowDays: 30,
  leadTimeMinHours: 2,
  cancellationDeadlineHours: 24,
  shopCapacity: 1,
  serviceCapacity: 1,
  staffCapacity: 1,
};

/**
 * スコープ別ルールを統合し ResolvedBookingRules を作る。
 * - 容量は各スコープの値を採用（無ければデフォルト）。
 * - slotInterval/window/leadTime/cancel は SERVICE > SHOP > default の優先で解決。
 */
export function resolveBookingRules(params: {
  shopRule?: CapacityRuleInput | null;
  serviceRule?: CapacityRuleInput | null;
  staffRule?: CapacityRuleInput | null;
  serviceSlotIntervalMin?: number;
  shopCapacityFallback?: number;
  serviceCapacityFallback?: number;
  staffCapacityFallback?: number;
}): ResolvedBookingRules {
  const { shopRule, serviceRule, staffRule } = params;

  const pick = <T>(...vals: (T | undefined | null)[]): T | undefined =>
    vals.find((v) => v !== undefined && v !== null) ?? undefined;

  return {
    slotIntervalMin:
      pick(
        serviceRule?.slotIntervalMin,
        params.serviceSlotIntervalMin,
        shopRule?.slotIntervalMin,
      ) ?? DEFAULT_RULES.slotIntervalMin,
    bookingWindowDays:
      pick(serviceRule?.bookingWindowDays, shopRule?.bookingWindowDays) ??
      DEFAULT_RULES.bookingWindowDays,
    leadTimeMinHours:
      pick(serviceRule?.leadTimeMinHours, shopRule?.leadTimeMinHours) ??
      DEFAULT_RULES.leadTimeMinHours,
    cancellationDeadlineHours:
      pick(serviceRule?.cancellationDeadlineHours, shopRule?.cancellationDeadlineHours) ??
      DEFAULT_RULES.cancellationDeadlineHours,
    shopCapacity:
      shopRule?.maxConcurrent ?? params.shopCapacityFallback ?? DEFAULT_RULES.shopCapacity,
    serviceCapacity:
      serviceRule?.maxConcurrent ?? params.serviceCapacityFallback ?? DEFAULT_RULES.serviceCapacity,
    staffCapacity:
      staffRule?.maxConcurrent ?? params.staffCapacityFallback ?? DEFAULT_RULES.staffCapacity,
  };
}

/** 受付期間内か（開始が now から windowDays 以内）。 */
export function isWithinBookingWindow(
  startAt: Date,
  now: Date,
  bookingWindowDays: number,
): boolean {
  if (startAt.getTime() < now.getTime()) return false;
  return differenceInCalendarDays(startAt, now) <= bookingWindowDays;
}

/** 締切前か（開始の leadTimeMinHours 時間前を過ぎていない）。 */
export function satisfiesLeadTime(startAt: Date, now: Date, leadTimeMinHours: number): boolean {
  // 絶対時間(ms)で比較。differenceInHours は切り捨てのため境界が最大1時間ずれる。
  return startAt.getTime() - now.getTime() >= leadTimeMinHours * MS_PER_HOUR;
}

/** キャンセル可能か（開始の cancellationDeadlineHours 時間前を過ぎていない）。 */
export function isCancellable(
  startAt: Date,
  now: Date,
  cancellationDeadlineHours: number,
): boolean {
  return startAt.getTime() - now.getTime() >= cancellationDeadlineHours * MS_PER_HOUR;
}
