/**
 * タイムラインの段割り。重なった予約が「見えない・押せない」状態にならないことを保証する。
 */
import { describe, it, expect } from 'vitest';
import { assignTracks } from '@/lib/schedule-layout';

const b = (id: string, startMin: number, endMin: number) => ({ id, startMin, endMin });

describe('assignTracks', () => {
  it('重ならない予約は1段に収まる', () => {
    const r = assignTracks([b('a', 600, 660), b('b', 720, 780)]);
    expect(r.trackCount).toBe(1);
    expect(r.blocks.every((x) => x.track === 0)).toBe(true);
  });

  it('連続予約（前の終了＝次の開始）も1段', () => {
    const r = assignTracks([b('a', 600, 660), b('b', 660, 720)]);
    expect(r.trackCount).toBe(1);
  });

  it('完全に同時刻の3件は3段に分かれる（全件が見える）', () => {
    const r = assignTracks([b('a', 600, 660), b('b', 600, 660), b('c', 600, 660)]);
    expect(r.trackCount).toBe(3);
    expect(new Set(r.blocks.map((x) => x.track)).size).toBe(3);
  });

  it('部分的な重なりでも段数は同時重なり数どまり', () => {
    // 10:00-11:00 / 10:30-11:30 / 11:00-12:00 → 最大2重なり
    const r = assignTracks([b('a', 600, 660), b('b', 630, 690), b('c', 660, 720)]);
    expect(r.trackCount).toBe(2);
    const byId = Object.fromEntries(r.blocks.map((x) => [x.id, x.track]));
    expect(byId.a).not.toBe(byId.b);
    expect(byId.c).toBe(byId.a); // a が終わった段を再利用
  });

  it('入力順に依存しない（開始時刻でソートしてから割り当てる）', () => {
    const asc = assignTracks([b('a', 600, 660), b('b', 630, 690)]);
    const desc = assignTracks([b('b', 630, 690), b('a', 600, 660)]);
    expect(desc.trackCount).toBe(asc.trackCount);
    expect(desc.blocks.map((x) => x.id)).toEqual(asc.blocks.map((x) => x.id));
  });

  it('空でも段数は1（高さ0のレーンを作らない）', () => {
    const r = assignTracks([]);
    expect(r.trackCount).toBe(1);
    expect(r.blocks).toEqual([]);
  });

  it('元の要素の情報を保持する', () => {
    const r = assignTracks([{ ...b('a', 600, 660), customerName: '山田' }]);
    expect(r.blocks[0]!.customerName).toBe('山田');
    expect(r.blocks[0]!.track).toBe(0);
  });
});
