import { describe, it, expect } from 'vitest';
import { computeAvailability } from '@/domain/booking/availability';
import { DEFAULT_RULES } from '@/domain/booking/rules';
import { zonedDateMinutesToUtc } from '@/lib/time';
import { singleSegment } from '@/domain/booking/occupancy';
import type { AvailabilityInput, OccupiedInterval, StaffWorkingInterval } from '@/domain/booking/types';

const TZ = 'Asia/Tokyo';
const d = (s: string) => new Date(s);

// 9:00-12:00 JST = 00:00Z-03:00Z
const OPEN_9_12 = [{ start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T03:00:00Z') }];

function buildInput(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    serviceId: 'svc1',
    date: '2026-06-15',
    timeZone: TZ,
    openIntervals: OPEN_9_12,
    dayStatus: 'OPEN',
    segments: singleSegment(60),
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    rules: {
      slotIntervalMin: 60,
      bookingWindowDays: 30,
      leadTimeMinHours: 2,
      cancellationDeadlineHours: 24,
      shopCapacity: 1,
      serviceCapacity: 1,
      staffCapacity: 1,
    },
    staffId: null,
    candidateStaffIds: [],
    staffWorkingIntervals: [],
    occupied: [],
    now: d('2026-06-10T00:00:00Z'), // 余裕を持って過去
    ...over,
  };
}

describe('availability: 基本スロット生成', () => {
  it('9-12時・60分刻みで3枠（9/10/11時）すべて空き', () => {
    const slots = computeAvailability(buildInput());
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.startAt.toISOString())).toEqual([
      '2026-06-15T00:00:00.000Z',
      '2026-06-15T01:00:00.000Z',
      '2026-06-15T02:00:00.000Z',
    ]);
    expect(slots.every((s) => s.available)).toBe(true);
    expect(slots.every((s) => s.remaining === 1)).toBe(true);
  });

  it('休業日（営業区間なし）は空配列', () => {
    const slots = computeAvailability(buildInput({ openIntervals: [], dayStatus: 'TEMP_CLOSED' }));
    expect(slots).toHaveLength(0);
  });
});

describe('availability: 容量・満席', () => {
  it('店舗容量1で既存予約がある枠は SLOT_FULL', () => {
    const occupied: OccupiedInterval[] = [
      { start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T01:00:00Z'), staffId: null, serviceId: 'svc1' },
    ];
    const slots = computeAvailability(buildInput({ occupied }));
    const nine = slots.find((s) => s.startAt.toISOString() === '2026-06-15T00:00:00.000Z')!;
    expect(nine.available).toBe(false);
    expect(nine.reason).toBe('SLOT_FULL');
    const ten = slots.find((s) => s.startAt.toISOString() === '2026-06-15T01:00:00.000Z')!;
    expect(ten.available).toBe(true);
  });

  it('店舗容量3なら同枠でも残2', () => {
    const occupied: OccupiedInterval[] = [
      { start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T01:00:00Z'), staffId: null, serviceId: 'svc1' },
    ];
    const input = buildInput({ occupied });
    input.rules.shopCapacity = 3;
    input.rules.serviceCapacity = 3;
    const nine = computeAvailability(input).find(
      (s) => s.startAt.toISOString() === '2026-06-15T00:00:00.000Z',
    )!;
    expect(nine.available).toBe(true);
    expect(nine.remaining).toBe(2);
  });
});

describe('availability: lead time / 受付期間', () => {
  it('当日9時時点では9時/10時枠は締切違反、11時枠(2h後)は可', () => {
    const slots = computeAvailability(buildInput({ now: d('2026-06-15T00:00:00Z') }));
    const byStart = (iso: string) => slots.find((s) => s.startAt.toISOString() === iso)!;
    expect(byStart('2026-06-15T00:00:00.000Z').reason).toBe('LEAD_TIME_VIOLATION');
    expect(byStart('2026-06-15T01:00:00.000Z').reason).toBe('LEAD_TIME_VIOLATION');
    expect(byStart('2026-06-15T02:00:00.000Z').available).toBe(true); // 2時間後ちょうど
  });

  it('受付期間(1日)を超える日付は BOOKING_WINDOW_EXCEEDED', () => {
    const input = buildInput({ now: d('2026-06-10T00:00:00Z') });
    input.rules.bookingWindowDays = 1; // 6/15 は now から5日先 → 期間外
    const slots = computeAvailability(input);
    expect(slots.every((s) => s.reason === 'BOOKING_WINDOW_EXCEEDED')).toBe(true);
  });
});

describe('availability: スタッフ制約', () => {
  it('指名スタッフが非稼働なら全枠 STAFF_UNAVAILABLE', () => {
    const slots = computeAvailability(buildInput({ staffId: 's1', staffWorkingIntervals: [] }));
    expect(slots.every((s) => s.reason === 'STAFF_UNAVAILABLE')).toBe(true);
  });

  it('おまかせ: スタッフ2名中1名が埋まっても残1で予約可', () => {
    const working: StaffWorkingInterval[] = [
      { staffId: 's1', start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T03:00:00Z') },
      { staffId: 's2', start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T03:00:00Z') },
    ];
    const occupied: OccupiedInterval[] = [
      { start: d('2026-06-15T00:00:00Z'), end: d('2026-06-15T01:00:00Z'), staffId: 's1', serviceId: 'svc1' },
    ];
    const input = buildInput({
      candidateStaffIds: ['s1', 's2'],
      staffWorkingIntervals: working,
      occupied,
    });
    input.rules.shopCapacity = 10;
    input.rules.serviceCapacity = 10;
    const nine = computeAvailability(input).find(
      (s) => s.startAt.toISOString() === '2026-06-15T00:00:00.000Z',
    )!;
    expect(nine.available).toBe(true);
    expect(nine.remaining).toBe(1); // s2 のみ空き
  });
});

/**
 * 「担当が必要なのに候補0人」を「スタッフ不要」と同一視すると、
 * 全枠が「空きあり」に見えて**確定ボタンでだけ失敗**する（客も店主も原因が分からない）。
 * 候補0人になる経路は複数ある: 担当チェックを外す / 指名不可にする / 停止中にする /
 * コンボで共通担当が居ない、など。エンジン側で必ず塞ぐ。
 */
describe('availability: 担当必須なのに候補0人', () => {
  const base = {
    serviceId: 'svc1',
    date: '2026-09-07',
    timeZone: 'Asia/Tokyo',
    dayStatus: 'OPEN' as const,
    segments: [{ offsetMin: 0, durationMin: 60 }],
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    rules: { ...DEFAULT_RULES, slotIntervalMin: 60, shopCapacity: 5, serviceCapacity: 5, staffCapacity: 1 },
    staffId: null,
    staffWorkingIntervals: [],
    occupied: [],
    now: new Date('2026-09-01T00:00:00Z'),
    openIntervals: [
      { start: zonedDateMinutesToUtc('2026-09-07', 600, 'Asia/Tokyo'), end: zonedDateMinutesToUtc('2026-09-07', 780, 'Asia/Tokyo') },
    ],
  };

  it('requiresStaff=true・候補0人 → 全枠が予約不可で理由は STAFF_UNAVAILABLE', () => {
    const slots = computeAvailability({ ...base, candidateStaffIds: [], requiresStaff: true });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => !s.available)).toBe(true);
    // 「満席」ではない。実際には予約が1件も入っていないため SLOT_FULL は事実と違う
    expect(slots.every((s) => s.reason === 'STAFF_UNAVAILABLE')).toBe(true);
    expect(slots.some((s) => s.reason === 'SLOT_FULL')).toBe(false);
  });

  it('requiresStaff=false（スタッフ不要サービス）は従来どおり予約可', () => {
    const slots = computeAvailability({ ...base, candidateStaffIds: [], requiresStaff: false });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.available)).toBe(true);
  });

  it('requiresStaff 未指定でも従来挙動を壊さない（後方互換）', () => {
    const slots = computeAvailability({ ...base, candidateStaffIds: [] });
    expect(slots.every((s) => s.available)).toBe(true);
  });
});

/**
 * 受付期間より先の日を「×（満）」と出すのは事実と違う（予約は1件も入っていない）。
 * 客が「満席だから諦める」のを防ぐため、理由を区別できる形で返す。
 */
describe('availability: 受付期間外は満席と区別される', () => {
  it('window を超えた日は全枠 BOOKING_WINDOW_EXCEEDED（SLOT_FULL ではない）', () => {
    const date = '2026-12-25'; // now から遠い日
    const slots = computeAvailability({
      serviceId: 'svc1',
      date,
      timeZone: 'Asia/Tokyo',
      dayStatus: 'OPEN',
      segments: [{ offsetMin: 0, durationMin: 60 }],
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      rules: { ...DEFAULT_RULES, slotIntervalMin: 60, bookingWindowDays: 30, shopCapacity: 5, serviceCapacity: 5 },
      staffId: null,
      candidateStaffIds: [],
      requiresStaff: false,
      staffWorkingIntervals: [],
      occupied: [],
      now: new Date('2026-09-01T00:00:00Z'),
      openIntervals: [
        { start: zonedDateMinutesToUtc(date, 600, 'Asia/Tokyo'), end: zonedDateMinutesToUtc(date, 780, 'Asia/Tokyo') },
      ],
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.reason === 'BOOKING_WINDOW_EXCEEDED')).toBe(true);
    expect(slots.some((s) => s.reason === 'SLOT_FULL')).toBe(false);
  });
});
