import { describe, it, expect } from 'vitest';
import { weekStart, monthFirst, monthFirstAdd, daysInMonth, monthGrid } from '@/lib/month-grid';

describe('weekStart', () => {
  it('月曜はその日のまま', () => {
    expect(weekStart('2026-09-14')).toBe('2026-09-14'); // 月
  });

  it('日曜は6日戻す（月曜始まりなので前の週に属する）', () => {
    expect(weekStart('2026-09-20')).toBe('2026-09-14'); // 日
  });

  it('月をまたいで戻る', () => {
    expect(weekStart('2026-09-01')).toBe('2026-08-31'); // 火 → 前月の月曜
  });
});

describe('monthFirstAdd', () => {
  it('年をまたいで進む', () => {
    expect(monthFirstAdd('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('年をまたいで戻る', () => {
    expect(monthFirstAdd('2026-01-01', -1)).toBe('2025-12-01');
  });

  it('日が末日でも存在しない日を作らない（1/31 の翌月は 2/1）', () => {
    expect(monthFirstAdd('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('12か月進めるとちょうど1年後', () => {
    expect(monthFirstAdd('2026-07-01', 12)).toBe('2027-07-01');
  });

  it('前月→翌月で元に戻る（1〜12月すべて）', () => {
    for (let m = 1; m <= 12; m++) {
      const d = `2026-${String(m).padStart(2, '0')}-01`;
      expect(monthFirstAdd(monthFirstAdd(d, -1), 1)).toBe(d);
    }
  });
});

describe('daysInMonth', () => {
  it('うるう年の2月は29日', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('100年ルール・400年ルール', () => {
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('大の月・小の月', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe('monthGrid', () => {
  it('2026年9月: 月曜始まりで8/31〜10/4', () => {
    const g = monthGrid('2026-09-14');
    expect(g.year).toBe(2026);
    expect(g.month).toBe(9);
    expect(g.monthStart).toBe('2026-09-01');
    expect(g.monthEnd).toBe('2026-09-30');
    expect(g.from).toBe('2026-08-31');
    expect(g.to).toBe('2026-10-04');
    expect(g.dates).toHaveLength(35);
  });

  it('月内のどの日を渡しても同じグリッドになる', () => {
    const a = monthGrid('2026-09-01');
    const b = monthGrid('2026-09-30');
    expect(b).toEqual(a);
  });

  it('セル数は常に7の倍数（12か月分）', () => {
    for (let m = 1; m <= 12; m++) {
      const g = monthGrid(`2026-${String(m).padStart(2, '0')}-15`);
      expect(g.dates.length % 7).toBe(0);
      expect(g.dates.length).toBeGreaterThanOrEqual(28);
      expect(g.dates.length).toBeLessThanOrEqual(42);
    }
  });

  it('グリッドは当月の全日を漏れなく含む', () => {
    for (let m = 1; m <= 12; m++) {
      const g = monthGrid(`2026-${String(m).padStart(2, '0')}-15`);
      const set = new Set(g.dates);
      for (let d = 1; d <= daysInMonth(2026, m); d++) {
        expect(set.has(`${g.monthStart.slice(0, 8)}${String(d).padStart(2, '0')}`)).toBe(true);
      }
      expect(g.from <= g.monthStart).toBe(true);
      expect(g.to >= g.monthEnd).toBe(true);
    }
  });

  it('日付は連続していて重複しない', () => {
    const g = monthGrid('2027-02-10');
    expect(new Set(g.dates).size).toBe(g.dates.length);
    for (let i = 1; i < g.dates.length; i++) {
      const prev = Date.parse(`${g.dates[i - 1]}T00:00:00Z`);
      const cur = Date.parse(`${g.dates[i]}T00:00:00Z`);
      expect(cur - prev).toBe(86_400_000);
    }
  });

  it('先頭・末尾が from / to と一致する', () => {
    const g = monthGrid('2026-02-01');
    expect(g.from).toBe(weekStart('2026-02-01'));
    expect(g.dates[0]).toBe(g.from);
    expect(g.dates[g.dates.length - 1]).toBe(g.to);
  });

  it('うるう年2月の末日を含む', () => {
    const g = monthGrid('2028-02-10');
    expect(g.monthEnd).toBe('2028-02-29');
    expect(g.dates).toContain('2028-02-29');
  });

  it('12月のグリッドは翌年の日を含みうる', () => {
    const g = monthGrid('2026-12-01');
    expect(g.monthEnd).toBe('2026-12-31');
    expect(g.to >= '2026-12-31').toBe(true);
  });
});
