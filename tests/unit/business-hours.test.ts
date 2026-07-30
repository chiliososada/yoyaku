import { describe, it, expect } from 'vitest';
import {
  resolveOpenIntervalsForDate,
  type BusinessHoursRow,
} from '@/domain/booking/business-hours';

const TZ = 'Asia/Tokyo';
const MON = '2026-06-15'; // 月曜
const SUN = '2026-06-21'; // 日曜
const monHours: BusinessHoursRow[] = [{ dayOfWeek: 1, openMinute: 540, closeMinute: 1080 }]; // 9-18

describe('business-hours: 通常営業', () => {
  it('月曜 9:00-18:00 → OPEN, 1区間（UTC変換）', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: monHours,
      isNationalHoliday: false,
      closeOnNationalHolidays: true,
    });
    expect(r.dayStatus).toBe('OPEN');
    expect(r.openIntervals).toHaveLength(1);
    expect(r.openIntervals[0]!.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(r.openIntervals[0]!.end.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('昼休み分割 → 2区間', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 540, closeMinute: 720 }, // 9-12
        { dayOfWeek: 1, openMinute: 780, closeMinute: 1080 }, // 13-18
      ],
      isNationalHoliday: false,
      closeOnNationalHolidays: true,
    });
    expect(r.openIntervals).toHaveLength(2);
    expect(r.openIntervals[0]!.end.toISOString()).toBe('2026-06-15T03:00:00.000Z'); // 12:00 JST
    expect(r.openIntervals[1]!.start.toISOString()).toBe('2026-06-15T04:00:00.000Z'); // 13:00 JST
  });

  it('定休日（曜日に営業時間なし） → REGULAR_CLOSED', () => {
    const r = resolveOpenIntervalsForDate({
      date: SUN,
      timeZone: TZ,
      businessHours: monHours,
      isNationalHoliday: false,
      closeOnNationalHolidays: true,
    });
    expect(r.dayStatus).toBe('REGULAR_CLOSED');
    expect(r.openIntervals).toHaveLength(0);
  });
});

describe('business-hours: 祝日 / 臨時休業 / 特別営業', () => {
  it('祝日 + 祝日休業設定 → HOLIDAY_CLOSED', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: monHours,
      isNationalHoliday: true,
      closeOnNationalHolidays: true,
    });
    expect(r.dayStatus).toBe('HOLIDAY_CLOSED');
    expect(r.openIntervals).toHaveLength(0);
  });

  it('祝日でも closeOnNationalHolidays=false なら営業', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: monHours,
      isNationalHoliday: true,
      closeOnNationalHolidays: false,
    });
    expect(r.dayStatus).toBe('OPEN');
  });

  it('臨時休業（SpecialDay CLOSED）は最優先 → TEMP_CLOSED', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: monHours,
      specialDay: { type: 'CLOSED', openMinute: null, closeMinute: null },
      isNationalHoliday: false,
      closeOnNationalHolidays: true,
    });
    expect(r.dayStatus).toBe('TEMP_CLOSED');
    expect(r.openIntervals).toHaveLength(0);
  });

  it('特別営業（定休の日曜だが営業） → SPECIAL_OPEN', () => {
    const r = resolveOpenIntervalsForDate({
      date: SUN,
      timeZone: TZ,
      businessHours: monHours, // 日曜は通常定休
      specialDay: { type: 'SPECIAL_OPEN', openMinute: 600, closeMinute: 900 }, // 10-15
      isNationalHoliday: false,
      closeOnNationalHolidays: true,
    });
    expect(r.dayStatus).toBe('SPECIAL_OPEN');
    expect(r.openIntervals).toHaveLength(1);
    expect(r.openIntervals[0]!.start.toISOString()).toBe('2026-06-21T01:00:00.000Z'); // 10:00 JST
  });
});

/**
 * 同じ曜日に複数行を置けるのは昼休みなどの分割営業のため（意図した機能）。
 * ただし**重なった区間**をそのまま返すと、computeAvailability が区間ごとに独立して
 * 候補時刻を生成するため、顧客の予約画面に同じ時刻が複数回並ぶ。
 * 入力時の検証（validation/admin.ts）に加えて、ここでも連結して潰す（多層防御）。
 */
describe('business-hours: 重なる区間の連結', () => {
  const at = (iso: string) => new Date(iso).toISOString();

  it('完全に同じ区間が2行 → 1区間に連結', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 1140 },
        { dayOfWeek: 1, openMinute: 600, closeMinute: 1140 },
      ],
      specialDay: null,
      isNationalHoliday: false,
      closeOnNationalHolidays: false,
    });
    expect(r.dayStatus).toBe('OPEN');
    expect(r.openIntervals).toHaveLength(1);
  });

  it('部分的に重なる2行 → 外側を包む1区間に連結', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 900 }, // 10-15
        { dayOfWeek: 1, openMinute: 840, closeMinute: 1140 }, // 14-19（14-15が重複）
      ],
      specialDay: null,
      isNationalHoliday: false,
      closeOnNationalHolidays: false,
    });
    expect(r.openIntervals).toHaveLength(1);
    expect(at(r.openIntervals[0]!.start.toISOString())).toBe('2026-06-15T01:00:00.000Z'); // 10:00 JST
    expect(at(r.openIntervals[0]!.end.toISOString())).toBe('2026-06-15T10:00:00.000Z'); // 19:00 JST
  });

  it('隣接（13:00終了→13:00開始）も1区間に連結', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 780 }, // 10-13
        { dayOfWeek: 1, openMinute: 780, closeMinute: 1140 }, // 13-19
      ],
      specialDay: null,
      isNationalHoliday: false,
      closeOnNationalHolidays: false,
    });
    expect(r.openIntervals).toHaveLength(1);
  });

  it('離れた2行（昼休み）は2区間のまま維持される', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 780 }, // 10-13
        { dayOfWeek: 1, openMinute: 900, closeMinute: 1140 }, // 15-19
      ],
      specialDay: null,
      isNationalHoliday: false,
      closeOnNationalHolidays: false,
    });
    expect(r.openIntervals).toHaveLength(2);
  });

  it('順序が逆に保存されていても正しく連結する', () => {
    const r = resolveOpenIntervalsForDate({
      date: MON,
      timeZone: TZ,
      businessHours: [
        { dayOfWeek: 1, openMinute: 840, closeMinute: 1140 },
        { dayOfWeek: 1, openMinute: 600, closeMinute: 900 },
      ],
      specialDay: null,
      isNationalHoliday: false,
      closeOnNationalHolidays: false,
    });
    expect(r.openIntervals).toHaveLength(1);
  });
});
