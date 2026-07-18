import { describe, it, expect } from 'vitest';
import {
  zonedDateMinutesToUtc,
  utcToZonedDateMinutes,
  isoDateDayOfWeek,
  isoDateAddDays,
  minutesToHHmm,
  hhmmToMinutes,
  intervalsOverlap,
  formatBookingDateTime,
  formatTime,
  zonedDateString,
} from '@/lib/time';

const TZ = 'Asia/Tokyo';

describe('time: zonedDateMinutesToUtc', () => {
  it('9:00 JST = 00:00 UTC（同日）', () => {
    expect(zonedDateMinutesToUtc('2026-06-15', 540, TZ).toISOString()).toBe(
      '2026-06-15T00:00:00.000Z',
    );
  });
  it('0:00 JST = 前日15:00 UTC', () => {
    expect(zonedDateMinutesToUtc('2026-06-15', 0, TZ).toISOString()).toBe(
      '2026-06-14T15:00:00.000Z',
    );
  });
  it('18:00 JST = 09:00 UTC', () => {
    expect(zonedDateMinutesToUtc('2026-06-15', 1080, TZ).toISOString()).toBe(
      '2026-06-15T09:00:00.000Z',
    );
  });
});

describe('time: utcToZonedDateMinutes（往復変換）', () => {
  it('UTC→ローカル日付と分', () => {
    const r = utcToZonedDateMinutes(new Date('2026-06-15T00:00:00.000Z'), TZ);
    expect(r).toEqual({ date: '2026-06-15', minutes: 540 });
  });
  it('日付境界をまたぐ（UTC前日→JST当日0:00）', () => {
    const r = utcToZonedDateMinutes(new Date('2026-06-14T15:00:00.000Z'), TZ);
    expect(r).toEqual({ date: '2026-06-15', minutes: 0 });
  });
  it('ラウンドトリップで一致', () => {
    const instant = zonedDateMinutesToUtc('2026-12-31', 1335, TZ); // 22:15
    expect(utcToZonedDateMinutes(instant, TZ)).toEqual({ date: '2026-12-31', minutes: 1335 });
  });
});

describe('time: 暦日ヘルパー', () => {
  it('isoDateDayOfWeek 2026-06-15 は月曜(1)', () => {
    expect(isoDateDayOfWeek('2026-06-15')).toBe(1);
  });
  it('isoDateDayOfWeek 2026-06-21 は日曜(0)', () => {
    expect(isoDateDayOfWeek('2026-06-21')).toBe(0);
  });
  it('isoDateAddDays は月跨ぎを処理', () => {
    expect(isoDateAddDays('2026-06-25', 10)).toBe('2026-07-05');
    expect(isoDateAddDays('2026-06-15', 30)).toBe('2026-07-15');
  });
  it('zonedDateString', () => {
    expect(zonedDateString(new Date('2026-06-14T15:00:00.000Z'), TZ)).toBe('2026-06-15');
  });
});

describe('time: 分↔HH:mm', () => {
  it('minutesToHHmm', () => {
    expect(minutesToHHmm(540)).toBe('09:00');
    expect(minutesToHHmm(1080)).toBe('18:00');
    expect(minutesToHHmm(0)).toBe('00:00');
  });
  it('hhmmToMinutes', () => {
    expect(hhmmToMinutes('09:00')).toBe(540);
    expect(hhmmToMinutes('18:30')).toBe(1110);
  });
});

describe('time: intervalsOverlap（半開区間）', () => {
  const d = (s: string) => new Date(s);
  it('重なる', () => {
    expect(
      intervalsOverlap(
        d('2026-06-15T00:00:00Z'),
        d('2026-06-15T01:00:00Z'),
        d('2026-06-15T00:30:00Z'),
        d('2026-06-15T01:30:00Z'),
      ),
    ).toBe(true);
  });
  it('端が接するだけは重ならない（半開）', () => {
    expect(
      intervalsOverlap(
        d('2026-06-15T00:00:00Z'),
        d('2026-06-15T01:00:00Z'),
        d('2026-06-15T01:00:00Z'),
        d('2026-06-15T02:00:00Z'),
      ),
    ).toBe(false);
  });
});

describe('time: 表示整形', () => {
  it('formatBookingDateTime（日本語・曜日付き）', () => {
    expect(formatBookingDateTime(new Date('2026-06-15T00:00:00.000Z'), TZ)).toBe(
      '2026年6月15日(月) 09:00',
    );
  });
  it('formatTime', () => {
    expect(formatTime(new Date('2026-06-15T09:00:00.000Z'), TZ)).toBe('18:00');
  });
});
