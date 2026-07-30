/**
 * 日本の「国民の祝日」を法令から算出する（純関数・DB非依存）。
 *
 * なぜ計算にするか:
 *   祝日をテーブルに手入力しておくと、入れた年を過ぎた瞬間に
 *   「祝日は休業」設定が**何のエラーも出さずに効かなくなる**。
 *   店主は元日に予約が入って初めて気づく——しかも原因は画面のどこにも出ない。
 *   祝日法はハッピーマンデー・振替休日・国民の休日まで含めて機械的に決まるので、
 *   データではなくロジックとして持つ（＝更新作業そのものを無くす）。
 *
 * 対応範囲: 2021年以降（東京五輪特例で祝日が移動した 2020/2021 の個別対応は含まない）。
 * 春分・秋分は 1980〜2099 年に有効な近似式を使用（官報の暦要項と一致する）。
 */

export interface JpHoliday {
  /** YYYY-MM-DD（日本の暦日） */
  date: string;
  name: string;
}

const FIXED: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: '元日' },
  { month: 2, day: 11, name: '建国記念の日' },
  { month: 2, day: 23, name: '天皇誕生日' },
  { month: 4, day: 29, name: '昭和の日' },
  { month: 5, day: 3, name: '憲法記念日' },
  { month: 5, day: 4, name: 'みどりの日' },
  { month: 5, day: 5, name: 'こどもの日' },
  { month: 8, day: 11, name: '山の日' },
  { month: 11, day: 3, name: '文化の日' },
  { month: 11, day: 23, name: '勤労感謝の日' },
];

/** ハッピーマンデー制度（第n月曜） */
const HAPPY_MONDAY: { month: number; nth: number; name: string }[] = [
  { month: 1, nth: 2, name: '成人の日' },
  { month: 7, nth: 3, name: '海の日' },
  { month: 9, nth: 3, name: '敬老の日' },
  { month: 10, nth: 2, name: 'スポーツの日' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** 暦日計算は UTC 固定。時刻を持たないのでタイムゾーンの影響を受けない。 */
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const toKey = (dt: Date) => key(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
const addDays = (dt: Date, n: number) => new Date(dt.getTime() + n * 86_400_000);

/** その月の第 nth 月曜の日 */
function nthMonday(year: number, month: number, nth: number): number {
  const firstDow = utc(year, month, 1).getUTCDay(); // 0=日
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (nth - 1) * 7;
}

/** 春分日（1980-2099 に有効な近似式。官報の暦要項と一致） */
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/** 秋分日（同上） */
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

/**
 * 指定年の祝日を全て返す（日付昇順）。
 * 振替休日・国民の休日を含む。
 */
export function jpHolidaysForYear(year: number): JpHoliday[] {
  const base = new Map<string, string>();
  for (const f of FIXED) base.set(key(year, f.month, f.day), f.name);
  for (const h of HAPPY_MONDAY) base.set(key(year, h.month, nthMonday(year, h.month, h.nth)), h.name);
  base.set(key(year, 3, vernalEquinoxDay(year)), '春分の日');
  base.set(key(year, 9, autumnalEquinoxDay(year)), '秋分の日');

  const all = new Map(base);

  // 国民の休日: 前日と翌日がいずれも祝日である平日（例: 敬老の日と秋分の日に挟まれた日）。
  // 判定は「本来の祝日」のみで行う（振替休日は判定材料にしない）。
  for (const k of [...base.keys()]) {
    const dt = utc(Number(k.slice(0, 4)), Number(k.slice(5, 7)), Number(k.slice(8, 10)));
    const next = addDays(dt, 2);
    const between = addDays(dt, 1);
    if (base.has(toKey(next)) && !base.has(toKey(between)) && between.getUTCDay() !== 0) {
      all.set(toKey(between), '国民の休日');
    }
  }

  // 振替休日: 祝日が日曜に当たるとき、その後の「祝日でない最初の日」を休日にする。
  // 5/3(日) のように連休の先頭が日曜だと 5/6 まで繰り下がる（連鎖する）。
  for (const k of [...base.keys()].sort()) {
    const dt = utc(Number(k.slice(0, 4)), Number(k.slice(5, 7)), Number(k.slice(8, 10)));
    if (dt.getUTCDay() !== 0) continue;
    let cur = addDays(dt, 1);
    while (all.has(toKey(cur))) cur = addDays(cur, 1);
    all.set(toKey(cur), '振替休日');
  }

  return [...all.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 指定日（YYYY-MM-DD）が祝日か。 */
export function isJpHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return false;
  return jpHolidaysForYear(year).some((h) => h.date === date);
}

/** [from, to)（YYYY-MM-DD）の祝日を日付昇順で返す。年をまたいでもよい。 */
export function jpHolidaysInRange(from: string, to: string): JpHoliday[] {
  const y1 = Number(from.slice(0, 4));
  const y2 = Number(to.slice(0, 4));
  if (!Number.isFinite(y1) || !Number.isFinite(y2) || y2 < y1) return [];
  const out: JpHoliday[] = [];
  for (let y = y1; y <= y2; y++) {
    for (const h of jpHolidaysForYear(y)) {
      if (h.date >= from && h.date < to) out.push(h);
    }
  }
  return out;
}

/** 指定日以降の祝日を limit 件返す（管理画面の一覧用）。 */
export function jpHolidaysFrom(date: string, limit: number): JpHoliday[] {
  const year = Number(date.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  const out: JpHoliday[] = [];
  for (let y = year; y <= year + 3 && out.length < limit; y++) {
    for (const h of jpHolidaysForYear(y)) {
      if (h.date >= date) out.push(h);
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}
