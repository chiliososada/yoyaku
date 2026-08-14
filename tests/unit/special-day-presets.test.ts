/**
 * 休業・特別営業の「区分」プリセット。
 *
 * 一番怖い壊れ方は「休みとして登録したのに、客の画面では予約できてしまう」こと。
 * 予約エンジンが見るのは DB の type だけなので、休業系プリセットは必ず CLOSED に落ちること、
 * 時刻入力が要る区分だけが needsHours になることを固定する。
 */
import { describe, it, expect } from 'vitest';
import { SPECIAL_DAY_PRESETS, findPreset } from '@/lib/special-day-presets';

describe('SPECIAL_DAY_PRESETS', () => {
  it('店主が選べる区分は6種類', () => {
    expect(SPECIAL_DAY_PRESETS.map((p) => p.label)).toEqual([
      '臨時休業',
      '年末年始休業',
      '祝日休業',
      '定休日',
      '特別営業',
      '営業時間変更',
    ]);
  });

  it('休業系はすべて CLOSED に落ちる（＝実際に予約を止める）', () => {
    for (const v of ['CLOSED', 'YEAR_END', 'HOLIDAY', 'REGULAR']) {
      expect(findPreset(v).type).toBe('CLOSED');
    }
  });

  it('営業系は CLOSED にしない', () => {
    expect(findPreset('SPECIAL_OPEN').type).toBe('SPECIAL_OPEN');
    expect(findPreset('MODIFIED_HOURS').type).toBe('MODIFIED_HOURS');
  });

  it('時刻入力が要るのは営業系だけ（休業日に開店時刻を聞かない）', () => {
    for (const p of SPECIAL_DAY_PRESETS) {
      expect(p.needsHours).toBe(p.type !== 'CLOSED');
    }
  });

  it('新しい区分には理由の既定値が入る（客のお知らせにそのまま出る）', () => {
    expect(findPreset('YEAR_END').defaultReason).toBe('年末年始休業');
    expect(findPreset('HOLIDAY').defaultReason).toBe('祝日休業');
    expect(findPreset('REGULAR').defaultReason).toBe('定休日');
  });

  it('臨時休業と営業系は理由を自由入力（既定値で上書きしない）', () => {
    expect(findPreset('CLOSED').defaultReason).toBe('');
    expect(findPreset('SPECIAL_OPEN').defaultReason).toBe('');
    expect(findPreset('MODIFIED_HOURS').defaultReason).toBe('');
  });

  it('知らない値は臨時休業として扱う（保存側で落ちない）', () => {
    expect(findPreset('NOPE').value).toBe('CLOSED');
    expect(findPreset('').type).toBe('CLOSED');
  });

  it('保存される type は DB の enum に存在する3種類だけ', () => {
    const allowed = new Set(['CLOSED', 'SPECIAL_OPEN', 'MODIFIED_HOURS']);
    for (const p of SPECIAL_DAY_PRESETS) expect(allowed.has(p.type)).toBe(true);
  });

  it('value は重複しない', () => {
    const vs = SPECIAL_DAY_PRESETS.map((p) => p.value);
    expect(new Set(vs).size).toBe(vs.length);
  });
});
