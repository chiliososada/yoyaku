/**
 * 予約状態・理由・曜日の日本語表示ラベル（UI 共有）。
 */
export const SLOT_REASON_LABEL: Record<string, string> = {
  SLOT_FULL: '満席',
  OUTSIDE_BUSINESS_HOURS: '時間外',
  STAFF_UNAVAILABLE: '指名不可',
  LEAD_TIME_VIOLATION: '受付終了',
  BOOKING_WINDOW_EXCEEDED: '受付前',
};

export const DAY_STATUS_LABEL: Record<string, string> = {
  OPEN: '営業日',
  SPECIAL_OPEN: '特別営業',
  REGULAR_CLOSED: '定休日',
  HOLIDAY_CLOSED: '祝日休業',
  TEMP_CLOSED: '臨時休業',
};

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  PENDING: '仮予約',
  CONFIRMED: '予約確定',
  COMPLETED: '来店済み',
  CANCELLED: 'キャンセル済み',
  NO_SHOW: '無断キャンセル',
};

export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];

/** ISO(UTC) を指定タイムゾーンの "HH:mm" に整形（クライアント用）。 */
export function formatTimeInTz(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
}

/** ISO(UTC) を "2026年6月18日(木) 11:00" に整形。 */
export function formatDateTimeInTz(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso));
  return parts;
}

/** yyyy-MM-dd の表示用 { day, weekday, month }。 */
export function describeIsoDate(dateStr: string): { day: number; month: number; weekday: string; dow: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay();
  return { day: d!, month: m!, weekday: WEEKDAY_JA[dow]!, dow };
}
