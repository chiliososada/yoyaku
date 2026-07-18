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

  for (const staffId of staffIds) {
    const overrides = schedules.filter(
      (s) => s.staffId === staffId && s.type === 'OVERRIDE' && s.date === date,
    );
    if (overrides.length > 0) {
      for (const o of overrides) {
        if (o.isWorking && o.startMinute != null && o.endMinute != null && o.endMinute > o.startMinute) {
          out.push({
            staffId,
            start: zonedDateMinutesToUtc(date, o.startMinute, timeZone),
            end: zonedDateMinutesToUtc(date, o.endMinute, timeZone),
          });
        }
      }
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
    for (const r of recurring) {
      out.push({
        staffId,
        start: zonedDateMinutesToUtc(date, r.startMinute!, timeZone),
        end: zonedDateMinutesToUtc(date, r.endMinute!, timeZone),
      });
    }
  }

  return out;
}
