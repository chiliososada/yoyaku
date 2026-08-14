/**
 * 「休業・特別営業」の区分プリセット。
 *
 * DB の SpecialDayType は予約エンジンの分岐そのもの（CLOSED / SPECIAL_OPEN / MODIFIED_HOURS）で、
 * ここに値を足すと resolveOpenIntervalsForDate の「CLOSED 以外」経路へ落ち、
 * **休みにしたつもりの日が実際には閉まらない**という一番まずい壊れ方をする。
 *
 * 店主が区別したいのは仕組みではなく「何の休みか」なので、
 * 休業の理由をプリセットとして持ち、DB 上はすべて CLOSED に落とす。
 * 理由はホームページの「直近の休業・営業時間のお知らせ」と一覧にそのまま出るため、
 * 客にも「年末年始休業」と伝わる。
 */
export type SpecialDayPresetValue =
  | 'CLOSED'
  | 'YEAR_END'
  | 'HOLIDAY'
  | 'REGULAR'
  | 'SPECIAL_OPEN'
  | 'MODIFIED_HOURS';

export interface SpecialDayPreset {
  value: SpecialDayPresetValue;
  label: string;
  /** 実際に保存する種別（＝予約エンジンの挙動） */
  type: 'CLOSED' | 'SPECIAL_OPEN' | 'MODIFIED_HOURS';
  /** 理由欄の既定値。空なら店主に自由入力させる。 */
  defaultReason: string;
  /** 開店・閉店の入力が要るか */
  needsHours: boolean;
}

export const SPECIAL_DAY_PRESETS: SpecialDayPreset[] = [
  { value: 'CLOSED', label: '臨時休業', type: 'CLOSED', defaultReason: '', needsHours: false },
  { value: 'YEAR_END', label: '年末年始休業', type: 'CLOSED', defaultReason: '年末年始休業', needsHours: false },
  { value: 'HOLIDAY', label: '祝日休業', type: 'CLOSED', defaultReason: '祝日休業', needsHours: false },
  { value: 'REGULAR', label: '定休日', type: 'CLOSED', defaultReason: '定休日', needsHours: false },
  { value: 'SPECIAL_OPEN', label: '特別営業', type: 'SPECIAL_OPEN', defaultReason: '', needsHours: true },
  { value: 'MODIFIED_HOURS', label: '営業時間変更', type: 'MODIFIED_HOURS', defaultReason: '', needsHours: true },
];

export function findPreset(value: string): SpecialDayPreset {
  return SPECIAL_DAY_PRESETS.find((p) => p.value === value) ?? SPECIAL_DAY_PRESETS[0]!;
}
