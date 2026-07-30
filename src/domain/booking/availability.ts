/**
 * 予約可能スロット計算エンジン（純粋関数・DB非依存）。
 *
 * 入力(AvailabilityInput)はサービス層が DB から組み立てて渡す。
 * 出力は各スロットの available/remaining/reason。満席・休業・締切超過も明示。
 *
 * 制約の統合:
 *   remaining = min(店舗容量残, サービス容量残, スタッフ供給残)
 *   さらに lead time / booking window / 営業時間 / スタッフ稼働 を満たすこと。
 */
import { chainServiceDurationMin, computeChainOccupancy } from './occupancy';
import {
  filterByService,
  filterByStaff,
  peakOverlap,
  remainingCapacity,
} from './capacity';
import { isWithinBookingWindow, satisfiesLeadTime } from './rules';
import type {
  AvailabilityInput,
  ChainPart,
  OccupiedInterval,
  OpenInterval,
  SlotAvailability,
  StaffWorkingInterval,
} from './types';

const MS = 60_000;

/** working 区間群のいずれかが [start,end) を完全に覆うか。 */
function isWorkingDuring(
  intervals: StaffWorkingInterval[],
  staffId: string,
  start: Date,
  end: Date,
): boolean {
  return intervals.some(
    (w) =>
      w.staffId === staffId &&
      w.start.getTime() <= start.getTime() &&
      end.getTime() <= w.end.getTime(),
  );
}

/** 1つの営業区間から、刻み slotIntervalMin で候補開始時刻を生成。 */
function candidateStartsForOpen(
  open: OpenInterval,
  slotIntervalMin: number,
  svcDurationMin: number,
): Date[] {
  const out: Date[] = [];
  const stepMs = slotIntervalMin * MS;
  const lastAllowed = open.end.getTime() - svcDurationMin * MS;
  for (let t = open.start.getTime(); t <= lastAllowed; t += stepMs) {
    out.push(new Date(t));
  }
  return out;
}

/**
 * 指定占有(newSegments)に対し、稼働中かつ空きのある候補スタッフ一覧を返す。
 * サービス層が「おまかせ」予約時の担当割当に使用する。
 */
export function findAvailableStaff(params: {
  candidateStaffIds: string[];
  staffWorkingIntervals: StaffWorkingInterval[];
  occupied: OccupiedInterval[];
  newSegments: { start: Date; end: Date }[];
  serviceStart: Date;
  serviceEnd: Date;
  staffCapacity: number;
}): string[] {
  const { candidateStaffIds, staffWorkingIntervals, occupied, newSegments } = params;
  return candidateStaffIds.filter((sid) => {
    if (!isWorkingDuring(staffWorkingIntervals, sid, params.serviceStart, params.serviceEnd)) {
      return false;
    }
    const own = filterByStaff(occupied, sid);
    return peakOverlap(own, newSegments) < params.staffCapacity;
  });
}

/** メイン: 1日分のスロット可用性を計算（単一サービス/コンボ共通）。 */
export function computeAvailability(input: AvailabilityInput): SlotAvailability[] {
  const {
    openIntervals,
    rules,
    staffId,
    candidateStaffIds,
    staffWorkingIntervals,
    occupied,
    now,
  } = input;

  // 休業日: スロットなし
  if (openIntervals.length === 0) return [];

  // 単一サービスは「長さ1のチェーン」として正規化
  const parts: ChainPart[] = input.services ?? [
    {
      serviceId: input.serviceId,
      segments: input.segments,
      bufferBeforeMin: input.bufferBeforeMin,
      bufferAfterMin: input.bufferAfterMin,
      capacity: rules.serviceCapacity,
    },
  ];

  const svcDuration = chainServiceDurationMin(parts);

  const slots: SlotAvailability[] = [];

  for (const open of openIntervals) {
    const starts = candidateStartsForOpen(open, rules.slotIntervalMin, svcDuration);

    for (const startAt of starts) {
      const occ = computeChainOccupancy({ startAt, parts, staffId });
      const newSegments = occ.intervals.map((i) => ({ start: i.start, end: i.end }));
      const serviceEndAt = occ.serviceEndAt;

      // --- 容量計算（occupied は当日の店舗全体。層ごとにフィルタして集計） ---
      // 店舗レベル: 全占有に対するピーク（チェーン全区間）
      const shopRemaining = remainingCapacity(rules.shopCapacity, occupied, newSegments);
      // サービスレベル: 各サービスごとに自分の区間×自分の容量で判定し、最小を採用
      let serviceRemaining = Number.POSITIVE_INFINITY;
      for (let pi = 0; pi < occ.parts.length; pi++) {
        const p = occ.parts[pi]!;
        const partDef = parts[pi]!;
        const svcOccupied = filterByService(occupied, p.serviceId);
        const partSegments = p.intervals.map((i) => ({ start: i.start, end: i.end }));
        serviceRemaining = Math.min(
          serviceRemaining,
          remainingCapacity(partDef.capacity, svcOccupied, partSegments),
        );
      }

      // スタッフレベル
      let staffRemaining: number;
      let staffReasonFail = false;
      if (staffId) {
        // 指名: 稼働中かつ空き
        const working = isWorkingDuring(staffWorkingIntervals, staffId, startAt, serviceEndAt);
        const own = filterByStaff(occupied, staffId);
        const rem = rules.staffCapacity - peakOverlap(own, newSegments);
        staffRemaining = working ? rem : 0;
        staffReasonFail = !working;
      } else if (candidateStaffIds.length > 0) {
        // おまかせ: 稼働中かつ空きのスタッフ数
        const avail = findAvailableStaff({
          candidateStaffIds,
          staffWorkingIntervals,
          occupied,
          newSegments,
          serviceStart: startAt,
          serviceEnd: serviceEndAt,
          staffCapacity: rules.staffCapacity,
        });
        staffRemaining = avail.length;
      } else if (input.requiresStaff) {
        // 担当が必要なのに候補が0人。
        // ここを「スタッフ不要」と同一視すると全枠が「空きあり」に見え、客は日時・氏名・
        // 連絡先まで入力し終えた**最後の確定ボタンで初めて**失敗する（しかも理由が分からない）。
        // 空き0かつ理由は STAFF_UNAVAILABLE（満席ではない。実際には予約が1件も入っていない）。
        staffRemaining = 0;
        staffReasonFail = true;
      } else {
        // 本当にスタッフ不要なサービス
        staffRemaining = Number.POSITIVE_INFINITY;
      }

      const remaining = Math.max(
        0,
        Math.min(shopRemaining, serviceRemaining, staffRemaining),
      );

      // --- 時間制約 ---
      const leadOk = satisfiesLeadTime(startAt, now, rules.leadTimeMinHours);
      const windowOk = isWithinBookingWindow(startAt, now, rules.bookingWindowDays, input.timeZone);

      let available = true;
      let reason: SlotAvailability['reason'] | undefined;
      if (!leadOk) {
        available = false;
        reason = 'LEAD_TIME_VIOLATION';
      } else if (!windowOk) {
        available = false;
        reason = 'BOOKING_WINDOW_EXCEEDED';
      } else if (staffReasonFail || (staffRemaining <= 0 && remaining <= 0)) {
        available = false;
        reason = staffReasonFail ? 'STAFF_UNAVAILABLE' : 'SLOT_FULL';
      } else if (remaining <= 0) {
        available = false;
        reason = 'SLOT_FULL';
      }

      slots.push({
        startAt,
        serviceEndAt,
        endAt: occ.occupiedEndAt,
        available,
        remaining: Number.isFinite(remaining) ? remaining : 999,
        reason,
      });
    }
  }

  // 開始時刻で安定ソート
  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return slots;
}
