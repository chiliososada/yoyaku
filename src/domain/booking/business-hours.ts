/**
 * ある暦日の「有効な営業区間」を解決する（純粋関数）。
 * 優先順位（高い順）:
 *   1. 特別営業日(SpecialBusinessDay): CLOSED=臨時休業 / SPECIAL_OPEN / MODIFIED_HOURS
 *   2. 祝日(NATIONAL) かつ shop.closeOnNationalHolidays=true → 休業
 *   3. 定常営業時間(BusinessHours, 曜日別) → 区間あり=営業 / 無し=定休
 */
import { zonedDateMinutesToUtc, isoDateDayOfWeek } from '@/lib/time';
import type { DayStatus, OpenInterval } from './types';

export interface BusinessHoursRow {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}

export interface SpecialDayInput {
  type: 'CLOSED' | 'SPECIAL_OPEN' | 'MODIFIED_HOURS';
  openMinute: number | null;
  closeMinute: number | null;
}

export interface ResolveOpenIntervalsParams {
  date: string; // yyyy-MM-dd（店舗ローカル暦日）
  timeZone: string;
  businessHours: BusinessHoursRow[];
  specialDay?: SpecialDayInput | null;
  isNationalHoliday: boolean;
  closeOnNationalHolidays: boolean;
}

export interface ResolvedDay {
  dayStatus: DayStatus;
  openIntervals: OpenInterval[];
}

export function resolveOpenIntervalsForDate(params: ResolveOpenIntervalsParams): ResolvedDay {
  const { date, timeZone, businessHours, specialDay, isNationalHoliday, closeOnNationalHolidays } =
    params;

  const toInterval = (openMin: number, closeMin: number): OpenInterval => ({
    start: zonedDateMinutesToUtc(date, openMin, timeZone),
    end: zonedDateMinutesToUtc(date, closeMin, timeZone),
  });

  // 1. 特別営業日
  if (specialDay) {
    if (specialDay.type === 'CLOSED') {
      return { dayStatus: 'TEMP_CLOSED', openIntervals: [] };
    }
    if (specialDay.openMinute != null && specialDay.closeMinute != null) {
      return {
        dayStatus: 'SPECIAL_OPEN',
        openIntervals: [toInterval(specialDay.openMinute, specialDay.closeMinute)],
      };
    }
    // openMinute/closeMinute 未設定の MODIFIED_HOURS は定常にフォールバック
  }

  // 2. 祝日休業
  if (isNationalHoliday && closeOnNationalHolidays) {
    return { dayStatus: 'HOLIDAY_CLOSED', openIntervals: [] };
  }

  // 3. 定常営業時間（曜日別、複数区間可）
  const dow = isoDateDayOfWeek(date);
  const rows = businessHours
    .filter((b) => b.dayOfWeek === dow && b.closeMinute > b.openMinute)
    .sort((a, b) => a.openMinute - b.openMinute);

  if (rows.length === 0) {
    return { dayStatus: 'REGULAR_CLOSED', openIntervals: [] };
  }

  return {
    dayStatus: 'OPEN',
    openIntervals: rows.map((r) => toInterval(r.openMinute, r.closeMinute)),
  };
}
