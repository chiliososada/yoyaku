/**
 * サービスの占有区間計算。
 * 1サービスが複数セグメント（例: 塗布→放置→洗い流し）を持つ場合に対応。
 * セグメント間の空き時間はリソースを占有しない。buffer は前後に付与。
 */
import { addMin } from '@/lib/time';
import type { ChainPart, OccupancySegment, OccupiedInterval } from './types';

export interface ComputedOccupancy {
  /** 各占有区間（リソース競合判定に使用） */
  intervals: OccupiedInterval[];
  /** サービス終了時刻（buffer 除く、表示用） */
  serviceEndAt: Date;
  /** 占有の終端（buffer-after 含む） */
  occupiedEndAt: Date;
  /** 占有の始端（buffer-before 含む） */
  occupiedStartAt: Date;
}

/** 単一サービスのデフォルトセグメント（連続1区間）。 */
export function singleSegment(durationMin: number): OccupancySegment[] {
  return [{ offsetMin: 0, durationMin }];
}

/**
 * サービス開始 startAt に対する占有区間を計算する。
 * - segments は offset 昇順でなくてもよい（内部でソート）。
 * - buffer-before は最初のセグメント開始の前に、buffer-after は最後のセグメント終了の後に付く。
 */
export function computeServiceOccupancy(params: {
  startAt: Date;
  segments: OccupancySegment[];
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffId: string | null;
  serviceId: string;
}): ComputedOccupancy {
  const { startAt, bufferBeforeMin, bufferAfterMin, staffId, serviceId } = params;
  const segments = [...params.segments].sort((a, b) => a.offsetMin - b.offsetMin);
  if (segments.length === 0) {
    throw new Error('computeServiceOccupancy: segments must not be empty');
  }

  const intervals: OccupiedInterval[] = segments.map((seg) => ({
    start: addMin(startAt, seg.offsetMin),
    end: addMin(startAt, seg.offsetMin + seg.durationMin),
    staffId,
    serviceId,
  }));

  const first = intervals[0]!;
  const last = intervals[intervals.length - 1]!;
  const serviceEndAt = last.end;

  // buffer を前後の端のセグメントに反映
  first.start = addMin(first.start, -bufferBeforeMin);
  last.end = addMin(last.end, bufferAfterMin);

  return {
    intervals,
    serviceEndAt,
    occupiedStartAt: first.start,
    occupiedEndAt: last.end,
  };
}

/** チェーン内の1サービス分の占有結果。 */
export interface ChainPartOccupancy {
  serviceId: string;
  /** このサービスの占有区間（buffer 込み、serviceId/staffId タグ付き） */
  intervals: OccupiedInterval[];
  /** このサービスの開始（顧客向け、buffer-before 除く） */
  serviceStartAt: Date;
  /** このサービスの施術終了（buffer-after 除く） */
  serviceEndAt: Date;
}

export interface ComputedChainOccupancy {
  /** 全サービスの占有区間（チェーン順） */
  intervals: OccupiedInterval[];
  /** サービスごとの内訳（明細作成・service容量判定に使用） */
  parts: ChainPartOccupancy[];
  /** 最終サービスの施術終了（buffer 除く、表示用） */
  serviceEndAt: Date;
  occupiedStartAt: Date;
  occupiedEndAt: Date;
}

/**
 * 複数サービスを順に連結した占有を計算する（コンボ予約）。
 * 連結規則: 次サービスの占有開始 = 前サービスの占有終了（buffer-after 含む）。
 * つまり途中の buffer は「サービス間の片付け時間」としてそのまま占有される。
 */
export function computeChainOccupancy(params: {
  startAt: Date;
  parts: ChainPart[];
  staffId: string | null;
}): ComputedChainOccupancy {
  if (params.parts.length === 0) {
    throw new Error('computeChainOccupancy: parts must not be empty');
  }
  const partResults: ChainPartOccupancy[] = [];
  const all: OccupiedInterval[] = [];
  let cursor = params.startAt; // 現サービスの「サービス開始」時刻

  for (let i = 0; i < params.parts.length; i++) {
    const part = params.parts[i]!;
    const occ = computeServiceOccupancy({
      startAt: cursor,
      segments: part.segments,
      bufferBeforeMin: part.bufferBeforeMin,
      bufferAfterMin: part.bufferAfterMin,
      staffId: params.staffId,
      serviceId: part.serviceId,
    });
    partResults.push({
      serviceId: part.serviceId,
      intervals: occ.intervals,
      serviceStartAt: cursor,
      serviceEndAt: occ.serviceEndAt,
    });
    all.push(...occ.intervals);
    // 次サービスの占有開始 = 現サービスの占有終端。
    // computeServiceOccupancy は bufferBefore を開始から差し引くため、その分先へずらす。
    const next = params.parts[i + 1];
    if (next) cursor = addMin(occ.occupiedEndAt, next.bufferBeforeMin);
  }

  const first = partResults[0]!;
  const last = partResults[partResults.length - 1]!;
  return {
    intervals: all,
    parts: partResults,
    serviceEndAt: last.serviceEndAt,
    occupiedStartAt: first.intervals[0]!.start,
    occupiedEndAt: last.intervals[last.intervals.length - 1]!.end,
  };
}

/** チェーン全体の「顧客向け所要時間」（最初のサービス開始→最後の施術終了、分）。スロット生成に使用。 */
export function chainServiceDurationMin(parts: ChainPart[]): number {
  let cursorMin = 0; // startAt からの「現サービスのサービス開始」オフセット（分）
  let lastServiceEnd = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const sorted = [...part.segments].sort((a, b) => a.offsetMin - b.offsetMin);
    const lastSeg = sorted[sorted.length - 1]!;
    const serviceEnd = cursorMin + lastSeg.offsetMin + lastSeg.durationMin;
    lastServiceEnd = serviceEnd;
    // 次サービスのサービス開始 = 現占有終端(serviceEnd + bufferAfter) + 次の bufferBefore
    const next = parts[i + 1];
    if (next) cursorMin = serviceEnd + part.bufferAfterMin + next.bufferBeforeMin;
  }
  return lastServiceEnd;
}

/** サービスの総スパン（最初の占有開始〜最後の占有終了）の長さ（分）。スロット生成に使用。 */
export function occupancySpanMinutes(
  segments: OccupancySegment[],
  bufferBeforeMin: number,
  bufferAfterMin: number,
): number {
  const sorted = [...segments].sort((a, b) => a.offsetMin - b.offsetMin);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const startOffset = first.offsetMin - bufferBeforeMin;
  const endOffset = last.offsetMin + last.durationMin + bufferAfterMin;
  return endOffset - startOffset;
}
