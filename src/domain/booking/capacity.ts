/**
 * 容量計算（純粋関数）。
 *
 * 「ある瞬間の同時予約数」を正しく扱うため、半開区間 [start, end) の
 * ピーク重複数を区間端のスイープで算出する。長さの異なる予約が混在しても正確。
 */
import { intervalsOverlap } from '@/lib/time';
import type { OccupiedInterval } from './types';

export interface SimpleInterval {
  start: Date;
  end: Date;
}

/** intervals のうち、瞬間 t（含む, 半開区間 [start,end)）を覆う数。 */
function countCovering(intervals: SimpleInterval[], t: number): number {
  let c = 0;
  for (const iv of intervals) {
    if (iv.start.getTime() <= t && t < iv.end.getTime()) c++;
  }
  return c;
}

/**
 * newSegments が占有する時間内における existing のピーク重複数。
 * 半開区間では重複の極大は必ずいずれかの区間開始点で生じるため、
 * 「newSegments の各開始点」と「newSegments 内に入る existing の各開始点」のみ評価すればよい。
 */
export function peakOverlap(
  existing: SimpleInterval[],
  newSegments: SimpleInterval[],
): number {
  if (newSegments.length === 0) return 0;
  const within = (t: number) => newSegments.some((s) => s.start.getTime() <= t && t < s.end.getTime());

  const candidateInstants = new Set<number>();
  for (const s of newSegments) candidateInstants.add(s.start.getTime());
  for (const e of existing) {
    const t = e.start.getTime();
    if (within(t)) candidateInstants.add(t);
  }

  let peak = 0;
  for (const t of candidateInstants) {
    if (!within(t)) continue;
    peak = Math.max(peak, countCovering(existing, t));
  }
  return peak;
}

/** existing のうち newSegments のいずれかと重なるものだけ抽出。 */
export function overlappingOnly(
  existing: SimpleInterval[],
  newSegments: SimpleInterval[],
): SimpleInterval[] {
  return existing.filter((e) =>
    newSegments.some((s) => intervalsOverlap(e.start, e.end, s.start, s.end)),
  );
}

/** スタッフ単位の占有のみ抽出。 */
export function filterByStaff(
  occupied: OccupiedInterval[],
  staffId: string,
): SimpleInterval[] {
  return occupied.filter((o) => o.staffId === staffId);
}

/** サービス単位の占有のみ抽出。 */
export function filterByService(
  occupied: OccupiedInterval[],
  serviceId: string,
): SimpleInterval[] {
  return occupied.filter((o) => o.serviceId === serviceId);
}

/**
 * 容量に対する残り受付可能数 = capacity - ピーク既存重複数。
 * 0 以下なら満席。
 */
export function remainingCapacity(
  capacity: number,
  existing: SimpleInterval[],
  newSegments: SimpleInterval[],
): number {
  const peak = peakOverlap(existing, newSegments);
  return capacity - peak;
}
