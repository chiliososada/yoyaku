/**
 * カレンダーの日付計算（純関数・DB/タイムゾーン非依存）。
 *
 * 月送りは「日を保ったまま月を足す」と 1/31 → 2/31 のような存在しない日ができ、
 * 環境によって 3/3 に繰り上がる。表示中の月が黙って飛ぶと店主は気づけないので、
 * 月の計算は必ず「その月の1日」で行う。
 */
import { isoDateAddDays, isoDateDayOfWeek } from '@/lib/time';

/** 週の起点（月曜）へ丸める。日本のシフト表は月曜始まりが一般的。 */
export function weekStart(date: string): string {
  const dow = isoDateDayOfWeek(date); // 0=日
  return isoDateAddDays(date, dow === 0 ? -6 : 1 - dow);
}

/** その月の1日（YYYY-MM-01）。 */
export function monthFirst(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** n か月ずらした月の1日。年またぎも通し月数で計算するのでずれない。 */
export function monthFirstAdd(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
}

/** その月の日数（うるう年を含む）。month は 1〜12。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface MonthGrid {
  year: number;
  /** 1〜12 */
  month: number;
  monthStart: string;
  monthEnd: string;
  /** グリッド左上の日（月曜）。前月のはみ出しを含む。 */
  from: string;
  /** グリッド右下の日（日曜）。翌月のはみ出しを含む。 */
  to: string;
  /** from〜to の全日付。必ず7の倍数。 */
  dates: string[];
}

/**
 * 月曜始まりの月間グリッド。
 * 前後の月のはみ出し分も日付として返す（空欄にすると「予約が無い日」と読めてしまうため、
 * 呼び出し側は薄く表示しつつ実データを入れる）。
 */
export function monthGrid(date: string): MonthGrid {
  const monthStart = monthFirst(date);
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7));
  const monthEnd = `${monthStart.slice(0, 8)}${String(daysInMonth(year, month)).padStart(2, '0')}`;

  const from = weekStart(monthStart);
  const to = isoDateAddDays(weekStart(monthEnd), 6);
  const count = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  const dates = Array.from({ length: count }, (_, i) => isoDateAddDays(from, i));

  return { year, month, monthStart, monthEnd, from, to, dates };
}
