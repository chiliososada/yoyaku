/**
 * スタッフのシフトから、ある暦日の稼働区間（UTC）を解決する純粋関数。
 * 優先: 当日の OVERRIDE > 曜日の RECURRING。
 * OVERRIDE で isWorking=false は欠勤（稼働なし）。
 */
import { zonedDateMinutesToUtc, isoDateDayOfWeek } from '@/lib/time';
import type { StaffWorkingInterval } from './types';

export interface ScheduleRow {
  staffId: string;
  type: 'RECURRING' | 'OVERRIDE';
  dayOfWeek: number | null;
  /** OVERRIDE 用の暦日 yyyy-MM-dd */
  date: string | null;
  startMinute: number | null;
  endMinute: number | null;
  isWorking: boolean;
}

export function resolveStaffWorkingIntervals(params: {
  date: string;
  timeZone: string;
  staffIds: string[];
  schedules: ScheduleRow[];
}): StaffWorkingInterval[] {
  const { date, timeZone, staffIds, schedules } = params;
  const dow = isoDateDayOfWeek(date);
  const out: StaffWorkingInterval[] = [];

  /**
   * 同一スタッフの重なる／隣接する区間を1本に連結する。
   * isWorkingDuring（availability.ts）は「1本の区間が施術全体を覆う」ことを要求するため、
   * 10:00-15:00 と 14:00-19:00 を別々に持つと、継ぎ目をまたぐ長いメニューだけが
   * 予約不可になる。店主から見ると「昼から夜まで出勤にしたのに60分メニューが取れない」
   * という原因不明の症状になるので、判定前に必ず均す（営業時間側と同じ方針）。
   */
  const mergeForStaff = (staffId: string, raw: Array<{ s: number; e: number }>) => {
    const sorted = [...raw].sort((a, b) => a.s - b.s);
    const merged: Array<{ s: number; e: number }> = [];
    for (const iv of sorted) {
      const last = merged[merged.length - 1];
      if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
      else merged.push({ ...iv });
    }
    for (const m of merged) {
      out.push({
        staffId,
        start: zonedDateMinutesToUtc(date, m.s, timeZone),
        end: zonedDateMinutesToUtc(date, m.e, timeZone),
      });
    }
  };

  for (const staffId of staffIds) {
    const overrides = schedules.filter(
      (s) => s.staffId === staffId && s.type === 'OVERRIDE' && s.date === date,
    );
    if (overrides.length > 0) {
      mergeForStaff(
        staffId,
        overrides
          .filter((o) => o.isWorking && o.startMinute != null && o.endMinute != null && o.endMinute > o.startMinute)
          .map((o) => ({ s: o.startMinute!, e: o.endMinute! })),
      );
      continue; // OVERRIDE があれば RECURRING は無視
    }

    const recurring = schedules.filter(
      (s) =>
        s.staffId === staffId &&
        s.type === 'RECURRING' &&
        s.dayOfWeek === dow &&
        s.isWorking &&
        s.startMinute != null &&
        s.endMinute != null &&
        s.endMinute > s.startMinute,
    );
    mergeForStaff(staffId, recurring.map((r) => ({ s: r.startMinute!, e: r.endMinute! })));
  }

  return out;
}
