/**
 * 郵便番号の正規化と外部応答の取り出し。
 * 表記ゆれで引けないと「入れたのに出ない」になり、原因が画面に出ない。
 */
import { describe, it, expect } from 'vitest';
import { normalizePostalCode, formatPostalCode, parseZipcloud } from '@/lib/postal';

describe('normalizePostalCode', () => {
  it('店主が打ちうる表記をすべて同じ7桁にする', () => {
    for (const v of ['1050004', '105-0004', '〒105-0004', '１０５－０００４', ' 105 0004 ', '105—0004']) {
      expect(normalizePostalCode(v)).toBe('1050004');
    }
  });
  it('桁数が違えば null（部分入力で問い合わせない）', () => {
    for (const v of ['', '105', '105-000', '10500045', 'abcdefg']) {
      expect(normalizePostalCode(v)).toBeNull();
    }
  });
  it('null / undefined でも落ちない', () => {
    expect(normalizePostalCode(null)).toBeNull();
    expect(normalizePostalCode(undefined)).toBeNull();
  });
  it('先頭ゼロを保持する（数値化しない）', () => {
    expect(normalizePostalCode('0600001')).toBe('0600001');
  });
});

describe('formatPostalCode', () => {
  it('7桁はハイフン付きにする', () => {
    expect(formatPostalCode('1050004')).toBe('105-0004');
    expect(formatPostalCode('105-0004')).toBe('105-0004');
  });
  it('7桁でなければそのまま返す（勝手に整形しない）', () => {
    expect(formatPostalCode('105')).toBe('105');
  });
});

describe('parseZipcloud', () => {
  const ok = {
    message: null,
    status: 200,
    results: [{ address1: '東京都', address2: '港区', address3: '新橋', zipcode: '1050004' }],
  };

  it('都道府県・市区町村・町域を取り出す', () => {
    expect(parseZipcloud(ok)).toEqual({ prefecture: '東京都', city: '港区', town: '新橋' });
  });
  it('該当なし（results: null）は null', () => {
    expect(parseZipcloud({ message: null, results: null, status: 200 })).toBeNull();
  });
  it('形が変わっても落ちない', () => {
    for (const v of [null, undefined, 'x', 42, {}, { results: 'x' }, { results: [] }]) {
      expect(parseZipcloud(v)).toBeNull();
    }
  });
  it('都道府県が取れないものは使わない', () => {
    expect(parseZipcloud({ results: [{ address2: '港区' }] })).toBeNull();
  });
  it('町域が空でも都道府県・市区町村が取れれば使う', () => {
    expect(parseZipcloud({ results: [{ address1: '北海道', address2: '札幌市中央区', address3: '' }] })).toEqual({
      prefecture: '北海道',
      city: '札幌市中央区',
      town: '',
    });
  });
});
