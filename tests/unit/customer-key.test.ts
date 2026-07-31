/**
 * 顧客カルテの同定キー。保存値と突き合わせ値が必ず一致することを守る。
 * ずれると常連が毎回新規カルテになり、来店回数・累計利用額・休眠判定が全部狂う。
 */
import { describe, it, expect } from 'vitest';
import { normalizeEmailKey, normalizePhoneKey } from '@/lib/customer-key';

describe('normalizeEmailKey', () => {
  it('大文字小文字を吸収する', () => {
    expect(normalizeEmailKey('Taro@Gmail.com')).toBe('taro@gmail.com');
    expect(normalizeEmailKey('taro@gmail.com')).toBe('taro@gmail.com');
  });
  it('前後の空白を落とす', () => {
    expect(normalizeEmailKey('  taro@x.jp ')).toBe('taro@x.jp');
  });
  it('空・未入力は null（キーにしない）', () => {
    expect(normalizeEmailKey('')).toBeNull();
    expect(normalizeEmailKey('   ')).toBeNull();
    expect(normalizeEmailKey(null)).toBeNull();
    expect(normalizeEmailKey(undefined)).toBeNull();
  });
});

describe('normalizePhoneKey', () => {
  it('表記ゆれを同じキーにする', () => {
    const want = '09012345678';
    for (const v of ['090-1234-5678', '09012345678', '090 1234 5678', '(090)1234-5678']) {
      expect(normalizePhoneKey(v)).toBe(want);
    }
  });
  it('全角数字も同じキーにする', () => {
    expect(normalizePhoneKey('０９０－１２３４－５６７８')).toBe('09012345678');
  });
  it('先頭ゼロを保持する（文字列として扱う）', () => {
    expect(normalizePhoneKey('090-0000-0000')).toBe('09000000000');
  });
  it('国番号表記は数字だけ残る', () => {
    expect(normalizePhoneKey('+81-90-1234-5678')).toBe('819012345678');
  });
  it('空・記号のみは null', () => {
    expect(normalizePhoneKey('')).toBeNull();
    expect(normalizePhoneKey('---')).toBeNull();
    expect(normalizePhoneKey(null)).toBeNull();
  });
});
