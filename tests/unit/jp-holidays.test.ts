/**
 * 祝日算出の単体テスト。
 * 2026年は官報の暦要項（従来テーブルへ手入力していた実データ）と完全一致することを確認する。
 */
import { describe, it, expect } from 'vitest';
import {
  jpHolidaysForYear,
  isJpHoliday,
  jpHolidaysInRange,
  jpHolidaysFrom,
} from '@/lib/jp-holidays';

// 手入力していた 2026 年の実データ（正解セット）
const KNOWN_2026 = [
  '2026-01-01', // 元日
  '2026-01-12', // 成人の日
  '2026-02-11', // 建国記念の日
  '2026-02-23', // 天皇誕生日
  '2026-03-20', // 春分の日
  '2026-04-29', // 昭和の日
  '2026-05-03', // 憲法記念日
  '2026-05-04', // みどりの日
  '2026-05-05', // こどもの日
  '2026-05-06', // 振替休日
  '2026-07-20', // 海の日
  '2026-08-11', // 山の日
  '2026-09-21', // 敬老の日
  '2026-09-22', // 国民の休日
  '2026-09-23', // 秋分の日
  '2026-10-12', // スポーツの日
  '2026-11-03', // 文化の日
  '2026-11-23', // 勤労感謝の日
];

describe('jp-holidays: 2026年は既知の実データと一致', () => {
  it('日付が完全一致する', () => {
    expect(jpHolidaysForYear(2026).map((h) => h.date)).toEqual(KNOWN_2026);
  });

  it('5/3が日曜のため振替休日は5/6まで繰り下がる（連鎖）', () => {
    const h = jpHolidaysForYear(2026).find((x) => x.date === '2026-05-06');
    expect(h?.name).toBe('振替休日');
  });

  it('敬老の日と秋分の日に挟まれた9/22は国民の休日', () => {
    const h = jpHolidaysForYear(2026).find((x) => x.date === '2026-09-22');
    expect(h?.name).toBe('国民の休日');
  });
});

describe('jp-holidays: 翌年以降も止まらない（手入力が不要）', () => {
  it('2027年の春分・秋分は官報どおり', () => {
    const y = jpHolidaysForYear(2027);
    expect(y.find((h) => h.name === '春分の日')?.date).toBe('2027-03-21');
    expect(y.find((h) => h.name === '秋分の日')?.date).toBe('2027-09-23');
  });

  it('2028年の春分・秋分は官報どおり', () => {
    const y = jpHolidaysForYear(2028);
    expect(y.find((h) => h.name === '春分の日')?.date).toBe('2028-03-20');
    expect(y.find((h) => h.name === '秋分の日')?.date).toBe('2028-09-22');
  });

  it('2027〜2035年のどの年も元日を含み、16日以上ある', () => {
    for (let y = 2027; y <= 2035; y++) {
      const list = jpHolidaysForYear(y);
      expect(list.some((h) => h.date === `${y}-01-01`)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(16);
    }
  });

  it('成人の日は必ず1月の第2月曜', () => {
    for (let y = 2026; y <= 2035; y++) {
      const d = jpHolidaysForYear(y).find((h) => h.name === '成人の日')!.date;
      const dt = new Date(`${d}T00:00:00Z`);
      expect(dt.getUTCDay()).toBe(1);
      expect(dt.getUTCDate()).toBeGreaterThanOrEqual(8);
      expect(dt.getUTCDate()).toBeLessThanOrEqual(14);
    }
  });

  it('祝日が重複した日付を返さない', () => {
    for (let y = 2026; y <= 2040; y++) {
      const dates = jpHolidaysForYear(y).map((h) => h.date);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });
});

describe('jp-holidays: 参照ヘルパー', () => {
  it('isJpHoliday', () => {
    expect(isJpHoliday('2026-01-01')).toBe(true);
    expect(isJpHoliday('2026-01-02')).toBe(false);
    expect(isJpHoliday('2027-01-01')).toBe(true);
  });

  it('範囲取得は [from, to) で年をまたげる', () => {
    const r = jpHolidaysInRange('2026-12-01', '2027-01-15');
    expect(r.map((h) => h.date)).toEqual(['2027-01-01', '2027-01-11']);
  });

  it('範囲取得は to を含まない', () => {
    expect(jpHolidaysInRange('2026-01-01', '2026-01-01')).toHaveLength(0);
    expect(jpHolidaysInRange('2026-01-01', '2026-01-02').map((h) => h.date)).toEqual(['2026-01-01']);
  });

  it('指定日以降を件数指定で取得（年をまたぐ）', () => {
    const r = jpHolidaysFrom('2026-11-01', 5);
    expect(r.map((h) => h.date)).toEqual([
      '2026-11-03',
      '2026-11-23',
      '2027-01-01',
      '2027-01-11',
      '2027-02-11',
    ]);
  });
});
