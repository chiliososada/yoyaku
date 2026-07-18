import { describe, it, expect } from 'vitest';
import { peakOverlap, remainingCapacity } from '@/domain/booking/capacity';

const iv = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });

describe('capacity: peakOverlap（半開区間のピーク並行数）', () => {
  it('重なりなし → 0', () => {
    const existing = [iv('2026-06-15T00:00:00Z', '2026-06-15T00:15:00Z')];
    const newSeg = [iv('2026-06-15T00:15:00Z', '2026-06-15T00:30:00Z')];
    expect(peakOverlap(existing, newSeg)).toBe(0);
  });

  it('2件が同時に重なる瞬間 → 2', () => {
    const existing = [
      iv('2026-06-15T00:00:00Z', '2026-06-15T01:00:00Z'),
      iv('2026-06-15T00:30:00Z', '2026-06-15T01:30:00Z'),
    ];
    const newSeg = [iv('2026-06-15T00:15:00Z', '2026-06-15T00:45:00Z')];
    // 0:30 の瞬間に両方が覆う
    expect(peakOverlap(existing, newSeg)).toBe(2);
  });

  it('時間差で最大1（連続するが重ならない既存）', () => {
    const existing = [
      iv('2026-06-15T00:00:00Z', '2026-06-15T00:30:00Z'),
      iv('2026-06-15T00:30:00Z', '2026-06-15T01:00:00Z'),
    ];
    const newSeg = [iv('2026-06-15T00:00:00Z', '2026-06-15T01:00:00Z')];
    expect(peakOverlap(existing, newSeg)).toBe(1);
  });
});

describe('capacity: remainingCapacity', () => {
  it('容量3・ピーク2 → 残1', () => {
    const existing = [
      iv('2026-06-15T00:00:00Z', '2026-06-15T01:00:00Z'),
      iv('2026-06-15T00:30:00Z', '2026-06-15T01:30:00Z'),
    ];
    const newSeg = [iv('2026-06-15T00:15:00Z', '2026-06-15T00:45:00Z')];
    expect(remainingCapacity(3, existing, newSeg)).toBe(1);
  });

  it('容量1・既存1（重なり）→ 残0（満席）', () => {
    const existing = [iv('2026-06-15T00:00:00Z', '2026-06-15T01:00:00Z')];
    const newSeg = [iv('2026-06-15T00:00:00Z', '2026-06-15T01:00:00Z')];
    expect(remainingCapacity(1, existing, newSeg)).toBe(0);
  });
});
