import { describe, it, expect } from 'vitest';
import {
  resolveBookingRules,
  isWithinBookingWindow,
  satisfiesLeadTime,
  isCancellable,
  DEFAULT_RULES,
} from '@/domain/booking/rules';
import { addMin } from '@/lib/time';

const now = new Date('2026-06-15T00:00:00.000Z');

describe('rules: resolveBookingRules（スコープ統合）', () => {
  it('ルール未指定はデフォルト', () => {
    expect(resolveBookingRules({})).toEqual(DEFAULT_RULES);
  });

  it('SERVICE が SHOP より優先（slotInterval/window）', () => {
    const r = resolveBookingRules({
      shopRule: {
        scope: 'SHOP',
        maxConcurrent: 5,
        slotIntervalMin: 30,
        bookingWindowDays: 60,
        leadTimeMinHours: 1,
        cancellationDeadlineHours: 12,
      },
      serviceRule: {
        scope: 'SERVICE',
        maxConcurrent: 2,
        slotIntervalMin: 15,
        bookingWindowDays: 14,
        leadTimeMinHours: 3,
        cancellationDeadlineHours: 48,
      },
    });
    expect(r.slotIntervalMin).toBe(15);
    expect(r.bookingWindowDays).toBe(14);
    expect(r.leadTimeMinHours).toBe(3);
    expect(r.shopCapacity).toBe(5);
    expect(r.serviceCapacity).toBe(2);
  });

  it('staff 容量フォールバック', () => {
    const r = resolveBookingRules({ staffCapacityFallback: 1 });
    expect(r.staffCapacity).toBe(1);
  });
});

describe('rules: 受付期間 / 締切 / キャンセル期限', () => {
  it('受付期間内', () => {
    expect(isWithinBookingWindow(addMin(now, 5 * 24 * 60), now, 30)).toBe(true);
  });
  it('受付期間外（30日超）', () => {
    expect(isWithinBookingWindow(addMin(now, 40 * 24 * 60), now, 30)).toBe(false);
  });
  it('過去は受付不可', () => {
    expect(isWithinBookingWindow(addMin(now, -60), now, 30)).toBe(false);
  });
  it('lead time 満たす（3時間後, 締切2h）', () => {
    expect(satisfiesLeadTime(addMin(now, 180), now, 2)).toBe(true);
  });
  it('lead time 違反（1時間後, 締切2h）', () => {
    expect(satisfiesLeadTime(addMin(now, 60), now, 2)).toBe(false);
  });
  it('キャンセル可能（48時間後, 期限24h）', () => {
    expect(isCancellable(addMin(now, 48 * 60), now, 24)).toBe(true);
  });
  it('キャンセル期限切れ（12時間後, 期限24h）', () => {
    expect(isCancellable(addMin(now, 12 * 60), now, 24)).toBe(false);
  });
});
