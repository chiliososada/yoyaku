/**
 * 色入力。カラーコードを知らない店主でも選べること、
 * 入力途中の文字列でピッカーが壊れないことを守る。
 */
import { describe, it, expect } from 'vitest';
import { normalizeHex, COLOR_PRESETS } from '@/components/ui/color-picker';
import { serviceFormSchema } from '@/lib/validation/admin';

describe('normalizeHex', () => {
  it('正しい6桁はそのまま返す', () => {
    expect(normalizeHex('#2563eb', '#000000')).toBe('#2563eb');
    expect(normalizeHex('#ABCDEF', '#000000')).toBe('#ABCDEF');
  });
  it('前後の空白は無視する', () => {
    expect(normalizeHex('  #2563eb ', '#000000')).toBe('#2563eb');
  });
  it('入力途中や不正な値は fallback（ピッカーを壊さない）', () => {
    for (const v of ['', '#', '#25', '#2563e', 'blue', '2563eb', '#2563ebb', '#12345g']) {
      expect(normalizeHex(v, '#4f46e5')).toBe('#4f46e5');
    }
  });
});

describe('COLOR_PRESETS', () => {
  it('すべて正しい6桁の色', () => {
    for (const c of COLOR_PRESETS) expect(/^#[0-9a-f]{6}$/.test(c.value)).toBe(true);
  });
  it('色が重複していない', () => {
    const vs = COLOR_PRESETS.map((c) => c.value);
    expect(new Set(vs).size).toBe(vs.length);
  });
  it('日本語のラベルが付いている（コードだけでは選べない）', () => {
    for (const c of COLOR_PRESETS) expect(c.label.length).toBeGreaterThan(0);
  });
  it('見本はすべてメニュー検証を通る', () => {
    const base = {
      name: 'カット', durationMin: 60, bufferAfterMin: 0, priceJpy: 4000,
      salePriceJpy: null, capacity: 1, requiresStaff: false, slotIntervalMin: 15,
      isActive: true, sortOrder: 0, staffIds: [], options: [],
    };
    for (const c of COLOR_PRESETS) {
      expect(serviceFormSchema.safeParse({ ...base, color: c.value }).success).toBe(true);
    }
  });
});

describe('メニューの表示色の検証', () => {
  const base = {
    name: 'カット', durationMin: 60, bufferAfterMin: 0, priceJpy: 4000,
    salePriceJpy: null, capacity: 1, requiresStaff: false, slotIntervalMin: 15,
    isActive: true, sortOrder: 0, staffIds: [], options: [],
  };
  it('未指定（空文字）は許可', () => {
    expect(serviceFormSchema.safeParse({ ...base, color: '' }).success).toBe(true);
  });
  it('書き間違いは理由付きで弾く（無言で色が消えるのを防ぐ）', () => {
    const r = serviceFormSchema.safeParse({ ...base, color: 'あお' });
    expect(r.success).toBe(false);
    const msg = r.success ? '' : r.error.issues.map((i) => i.message).join(' ');
    expect(msg).toContain('#RRGGBB');
    expect(msg).toContain('見本');
  });
  it('3桁省略形は弾く（CSSでは有効だが入口を1つに絞る）', () => {
    expect(serviceFormSchema.safeParse({ ...base, color: '#abc' }).success).toBe(false);
  });
});
