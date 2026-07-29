/**
 * 時刻ユーティリティ。
 *
 * 大原則:
 *  - 保存・計算はすべて UTC の Date（instant）。
 *  - 「店舗ローカルの暦日 + 0時からの分」と UTC instant の相互変換をここに集約。
 *  - 表示整形は formatInTz / 各 format ヘルパーのみを使い、生 Date を直接表示しない。
 *
 * 日本(Asia/Tokyo)は DST 非対象だが、date-fns-tz を使い将来の多国対応にも耐える実装にする。
 */
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addMinutes, addDays } from 'date-fns';

export const DEFAULT_TZ = 'Asia/Tokyo';
export const MINUTES_PER_DAY = 24 * 60;

/** 現在時刻（UTC instant）。テストで差し替えやすいよう関数化。 */
export function nowUtc(): Date {
  return new Date();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 店舗ローカルの「暦日(yyyy-MM-dd) + 0時からの分」を UTC instant に変換する。
 * 例: ('2026-06-15', 540 /* 09:00 *\/, 'Asia/Tokyo') => 2026-06-15T00:00:00.000Z
 */
export function zonedDateMinutesToUtc(
  localDate: string,
  minutesFromMidnight: number,
  timeZone: string = DEFAULT_TZ,
): Date {
  const dayOffset = Math.floor(minutesFromMidnight / MINUTES_PER_DAY);
  const within = ((minutesFromMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(within / 60);
  const m = within % 60;
  const baseDate = dayOffset === 0 ? localDate : isoDateAddDays(localDate, dayOffset);
  // 'yyyy-MM-ddTHH:mm:ss' を timeZone のウォールクロックとして解釈し UTC instant を得る。
  const wall = `${baseDate}T${pad2(h)}:${pad2(m)}:00`;
  return fromZonedTime(wall, timeZone);
}

/** UTC instant から、店舗ローカルの「暦日 と 0時からの分」を得る。 */
export function utcToZonedDateMinutes(
  instant: Date,
  timeZone: string = DEFAULT_TZ,
): { date: string; minutes: number } {
  const date = formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
  const h = Number(formatInTimeZone(instant, timeZone, 'HH'));
  const m = Number(formatInTimeZone(instant, timeZone, 'mm'));
  return { date, minutes: h * 60 + m };
}

/** 暦日文字列(yyyy-MM-dd)の曜日(0=日..6=土)。タイムゾーン非依存。 */
export function isoDateDayOfWeek(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
}

/** 暦日文字列に日数を加算（yyyy-MM-dd を返す）。 */
export function isoDateAddDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const next = addDays(dt, days);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

/** UTC instant が属する店舗ローカルの暦日(yyyy-MM-dd)。 */
export function zonedDateString(instant: Date, timeZone: string = DEFAULT_TZ): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** 表示用整形（タイムゾーン指定）。 */
export function formatInTz(
  instant: Date,
  fmt: string,
  timeZone: string = DEFAULT_TZ,
): string {
  return formatInTimeZone(instant, timeZone, fmt);
}

/** 予約日時の日本語表示。例: 2026年6月15日(月) 09:00 */
export function formatBookingDateTime(instant: Date, timeZone: string = DEFAULT_TZ): string {
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = wd[Number(formatInTimeZone(instant, timeZone, 'i')) % 7];
  return formatInTimeZone(instant, timeZone, `yyyy年M月d日(${dow}) HH:mm`);
}

/** 時刻のみ表示 HH:mm。 */
export function formatTime(instant: Date, timeZone: string = DEFAULT_TZ): string {
  return formatInTimeZone(instant, timeZone, 'HH:mm');
}

/** 管理画面向けの短い日本語日時。例: 6/18(木) 11:00 */
export function formatShortJa(instant: Date, timeZone: string = DEFAULT_TZ): string {
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const dow = wd[Number(formatInTimeZone(instant, timeZone, 'i')) % 7];
  return formatInTimeZone(instant, timeZone, `M/d(${dow}) HH:mm`);
}

/** 0時からの分(540) を "09:00" 表記へ。 */
export function minutesToHHmm(minutes: number): string {
  const within = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(within / 60))}:${pad2(within % 60)}`;
}

/** "09:00" を 0時からの分(540) へ。 */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** instant に分を加算。 */
export function addMin(instant: Date, minutes: number): Date {
  return addMinutes(instant, minutes);
}

/** 2つの半開区間 [aStart, aEnd) と [bStart, bEnd) が重なるか。 */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** 現在の店舗ローカル暦日(yyyy-MM-dd)。 */
export function todayInZone(timeZone: string = DEFAULT_TZ, now: Date = nowUtc()): string {
  return zonedDateString(now, timeZone);
}

/**
 * 指定タイムゾーンの「当月1日 0:00」を UTC instant で返す。
 * 例: JST の 2026-07-01 09:00(=UTC 00:00) に呼ぶと 2026-06-30T15:00:00Z（= JST 7/1 0:00）。
 * 月次クォータ集計を UTC暦月ではなく店舗ローカル暦月で切るために使う。
 */
export function monthStartInZone(now: Date = nowUtc(), timeZone: string = DEFAULT_TZ): Date {
  const ym = formatInTimeZone(now, timeZone, 'yyyy-MM');
  return fromZonedTime(`${ym}-01T00:00:00`, timeZone);
}
