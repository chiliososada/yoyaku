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

  // 重なる区間は連結して1つにする（多層防御）。
  // 入力時に validation/admin.ts で重なりを弾いているが、ここでも潰しておく理由:
  // 検証を入れる前に保存された行、API直叩き、将来の別経路からの投入があっても、
  // computeAvailability は区間ごとに独立して候補時刻を生成するため、区間が重なると
  // **顧客の予約画面に同じ時刻が複数回並ぶ**。表示の壊れ方が分かりにくいので入口だけに頼らない。
  // 隣接（13:00終了→13:00開始）も1区間に連結する。空き枠の生成結果は変わらない。
  const merged: Array<{ openMinute: number; closeMinute: number }> = [];
  for (const r of rows) {
    const last = merged[merged.length - 1];
    if (last && r.openMinute <= last.closeMinute) {
      last.closeMinute = Math.max(last.closeMinute, r.closeMinute);
    } else {
      merged.push({ openMinute: r.openMinute, closeMinute: r.closeMinute });
    }
  }

  return {
    dayStatus: 'OPEN',
    openIntervals: merged.map((r) => toInterval(r.openMinute, r.closeMinute)),
  };
}
