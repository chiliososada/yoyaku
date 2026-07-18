import { describe, it, expect } from 'vitest';
import {
  chainServiceDurationMin,
  computeChainOccupancy,
  computeServiceOccupancy,
  occupancySpanMinutes,
  singleSegment,
} from '@/domain/booking/occupancy';

const start = new Date('2026-06-15T00:00:00.000Z'); // 9:00 JST

describe('occupancy: 単一セグメント + buffer', () => {
  it('60分施術 + 後10分バッファ', () => {
    const r = computeServiceOccupancy({
      startAt: start,
      segments: singleSegment(60),
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      staffId: 's1',
      serviceId: 'svc1',
    });
    expect(r.intervals).toHaveLength(1);
    expect(r.intervals[0]!.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(r.intervals[0]!.end.toISOString()).toBe('2026-06-15T01:10:00.000Z'); // 占有は +buffer
    expect(r.serviceEndAt.toISOString()).toBe('2026-06-15T01:00:00.000Z'); // 施術終了は +60
    expect(r.occupiedEndAt.toISOString()).toBe('2026-06-15T01:10:00.000Z');
  });

  it('前バッファは占有開始を前倒し', () => {
    const r = computeServiceOccupancy({
      startAt: start,
      segments: singleSegment(60),
      bufferBeforeMin: 15,
      bufferAfterMin: 0,
      staffId: null,
      serviceId: 'svc1',
    });
    expect(r.occupiedStartAt.toISOString()).toBe('2026-06-14T23:45:00.000Z'); // 8:45 JST
  });
});

describe('occupancy: 複数セグメント（多時間帯占有）', () => {
  it('塗布30分→放置20分(空き)→洗い20分、後10分バッファ', () => {
    const r = computeServiceOccupancy({
      startAt: start,
      segments: [
        { offsetMin: 0, durationMin: 30 },
        { offsetMin: 50, durationMin: 20 },
      ],
      bufferBeforeMin: 0,
      bufferAfterMin: 10,
      staffId: 's1',
      serviceId: 'svc1',
    });
    expect(r.intervals).toHaveLength(2);
    // セグメント1: 9:00-9:30
    expect(r.intervals[0]!.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(r.intervals[0]!.end.toISOString()).toBe('2026-06-15T00:30:00.000Z');
    // セグメント2: 9:50-10:10、最後に +10 バッファ → 10:20
    expect(r.intervals[1]!.start.toISOString()).toBe('2026-06-15T00:50:00.000Z');
    expect(r.intervals[1]!.end.toISOString()).toBe('2026-06-15T01:20:00.000Z');
    // 施術終了（buffer除く）は10:10
    expect(r.serviceEndAt.toISOString()).toBe('2026-06-15T01:10:00.000Z');
    // 放置中の 9:30-9:50 は占有されない（intervalsに含まれない）
  });

  it('occupancySpanMinutes は全スパン（buffer込み）', () => {
    const span = occupancySpanMinutes(
      [
        { offsetMin: 0, durationMin: 30 },
        { offsetMin: 50, durationMin: 20 },
      ],
      0,
      10,
    );
    expect(span).toBe(80); // 0 .. (50+20+10)
  });
});

describe('occupancy: サービスチェーン（コンボ予約）', () => {
  const cut = {
    serviceId: 'cut',
    segments: singleSegment(60),
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    capacity: 1,
  };
  const colorSeg = {
    serviceId: 'color',
    segments: [
      { offsetMin: 0, durationMin: 40 },
      { offsetMin: 60, durationMin: 60 },
    ],
    bufferBeforeMin: 0,
    bufferAfterMin: 10,
    capacity: 1,
  };

  it('カット→カラー: 次サービスは前サービスの占有終端から開始', () => {
    const r = computeChainOccupancy({ startAt: start, parts: [cut, colorSeg], staffId: 's1' });
    // カット: 9:00-10:10（60分 + buffer10）
    expect(r.parts[0]!.intervals[0]!.start.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(r.parts[0]!.intervals[0]!.end.toISOString()).toBe('2026-06-15T01:10:00.000Z');
    // カラーは 10:10 開始: 塗布 10:10-10:50、放置(占有なし)、仕上げ 11:10-12:10 +buffer10 → 12:20
    expect(r.parts[1]!.serviceStartAt.toISOString()).toBe('2026-06-15T01:10:00.000Z');
    expect(r.parts[1]!.intervals[0]!.start.toISOString()).toBe('2026-06-15T01:10:00.000Z');
    expect(r.parts[1]!.intervals[0]!.end.toISOString()).toBe('2026-06-15T01:50:00.000Z');
    expect(r.parts[1]!.intervals[1]!.start.toISOString()).toBe('2026-06-15T02:10:00.000Z');
    expect(r.parts[1]!.intervals[1]!.end.toISOString()).toBe('2026-06-15T03:20:00.000Z');
    // 全体: 施術終了 = カラー仕上げ終了 12:10、占有終端 12:20
    expect(r.serviceEndAt.toISOString()).toBe('2026-06-15T03:10:00.000Z');
    expect(r.occupiedEndAt.toISOString()).toBe('2026-06-15T03:20:00.000Z');
    // interval には serviceId が付与される
    expect(r.intervals.map((i) => i.serviceId)).toEqual(['cut', 'color', 'color']);
  });

  it('chainServiceDurationMin = 開始→最終施術終了（途中バッファ込み・末尾バッファ除く）', () => {
    // カット60 + buffer10 + カラー(セグメント末端120) = 60+10+120 = 190分
    expect(chainServiceDurationMin([cut, colorSeg])).toBe(190);
    // 単一ならセグメント末端のみ
    expect(chainServiceDurationMin([cut])).toBe(60);
  });
});
