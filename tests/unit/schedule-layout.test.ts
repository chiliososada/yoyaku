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

/**
 * 「表示中の月に押せる日が1つも無い」判定（予約ウィザードの空状態）。
 * 月末に来店した客は必ずこの状態になるため、黙って全部グレーにしてはいけない。
 */
function hasBookableInMonth(
  grid: (string | null)[],
  status: Record<string, string>,
  today: string,
): boolean {
  return grid.some((d) => !!d && d >= today && (status[d] === 'OPEN' || status[d] === 'FEW'));
}

describe('カレンダーの空状態判定', () => {
  const july = Array.from({ length: 31 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`);

  it('月末（31日）に来て当月に空きが無ければ false', () => {
    const status: Record<string, string> = {};
    for (const d of july) status[d] = 'FULL';
    expect(hasBookableInMonth(july, status, '2026-07-31')).toBe(false);
  });

  it('先の日に空きが1つでもあれば true', () => {
    const status: Record<string, string> = {};
    for (const d of july) status[d] = 'FULL';
    status['2026-07-31'] = 'OPEN';
    expect(hasBookableInMonth(july, status, '2026-07-31')).toBe(true);
  });

  it('残少（FEW）も予約できるので true', () => {
    const status: Record<string, string> = { '2026-07-20': 'FEW' };
    expect(hasBookableInMonth(july, status, '2026-07-01')).toBe(true);
  });

  it('過去日に空きがあっても数えない', () => {
    const status: Record<string, string> = { '2026-07-05': 'OPEN' };
    expect(hasBookableInMonth(july, status, '2026-07-20')).toBe(false);
  });

  it('休業のみの月は false（「満」と区別せず、どちらも押せない）', () => {
    const status: Record<string, string> = {};
    for (const d of july) status[d] = 'CLOSED';
    expect(hasBookableInMonth(july, status, '2026-07-01')).toBe(false);
  });
});
