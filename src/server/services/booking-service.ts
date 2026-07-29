/**
 * 予約サービス（業務ロジック層）。
 *
 * 防超卖（オーバーブッキング防止）の中核:
 *   createBooking は単一トランザクション内で
 *     1) advisory lock で (店舗,暦日) を直列化
 *     2) ロック確立後に占有を読み直し、ドメインエンジンで容量を再判定（権威チェック）
 *     3) booking + booking_items を挿入（GiST 排他制約が最終防御）
 *   を行う。二人が最後の1枠を同時に取りに来ても、片方のみ成功する。
 */
import { randomInt } from 'node:crypto';
import { prisma, Prisma, type DbClient } from '@/lib/db';
import { Errors, type AppErrorCode } from '@/lib/errors';
import { nowUtc, zonedDateString, zonedDateMinutesToUtc, isoDateAddDays } from '@/lib/time';
import {
  computeAvailability,
  computeChainOccupancy,
  findAvailableStaff,
  isCancellable,
  resolveBookingRules,
  resolveOpenIntervalsForDate,
  resolveStaffWorkingIntervals,
  type ChainPart,
  type ResolvedBookingRules,
  type SlotAvailability,
  type SlotUnavailableReason,
} from '@/domain/booking';
import {
  acquireBookingLock,
  loadDayContext,
  loadOccupiedForDay,
  loadOccupiedOverlapping,
  loadRangeContext,
  loadSelectedOptions,
  loadServiceContext,
  type CapacityRuleRow,
  type ServiceContext,
  type ServiceOptionRow,
} from '@/server/repositories/booking-repository';
import { assertPublicBookingQuota } from '@/server/services/billing-quota-service';

// ---- ルール解決 ----

function pickRule(
  rules: CapacityRuleRow[],
  scope: 'SHOP' | 'SERVICE' | 'STAFF',
  match?: { serviceId?: string; staffId?: string },
): CapacityRuleRow | undefined {
  return rules.find(
    (r) =>
      r.scope === scope &&
      (scope !== 'SERVICE' || r.serviceId === match?.serviceId) &&
      (scope !== 'STAFF' || r.staffId === match?.staffId),
  );
}

function resolveRules(ctx: ServiceContext, staffId: string | null): ResolvedBookingRules {
  const shopRule = pickRule(ctx.capacityRules, 'SHOP');
  const serviceRule = pickRule(ctx.capacityRules, 'SERVICE', { serviceId: ctx.service.id });
  const staffRule = staffId
    ? pickRule(ctx.capacityRules, 'STAFF', { staffId })
    : undefined;

  const shopCapacityFallback =
    typeof ctx.shop.settings.shopCapacity === 'number'
      ? (ctx.shop.settings.shopCapacity as number)
      : 9999;

  return resolveBookingRules({
    shopRule,
    serviceRule,
    staffRule,
    serviceSlotIntervalMin: ctx.service.slotIntervalMin,
    shopCapacityFallback,
    serviceCapacityFallback: ctx.service.capacity,
    staffCapacityFallback: 1,
  });
}

// ---- コンボ（複数サービス連続予約）コンテキスト ----

export interface ServiceItemInput {
  serviceId: string;
  optionIds?: string[];
}

interface ComboContext {
  shop: ServiceContext['shop'];
  /** リクエスト順のサービス情報（オプション適用済み価格つき） */
  services: Array<
    ServiceContext['service'] & {
      options: ServiceOptionRow[];
      /** サービス本体 + オプションの小計（1名分） */
      subtotalJpy: number;
    }
  >;
  /** チェーン占有定義（オプションの延長を最終セグメントに適用済み） */
  parts: ChainPart[];
  /** 全サービスを担当できるスタッフの共通集合 */
  candidateStaffIds: string[];
  requiresStaff: boolean;
  /** 各サービスのルールを保守的に統合したもの */
  rules: ResolvedBookingRules;
}

/** オプションの延長（分）をサービスの最終セグメントに適用する。 */
function applyExtraMinutes(
  segments: ServiceContext['service']['segments'],
  extraMin: number,
): ServiceContext['service']['segments'] {
  if (extraMin <= 0) return segments;
  const sorted = [...segments].sort((a, b) => a.offsetMin - b.offsetMin);
  const last = sorted[sorted.length - 1]!;
  return [...sorted.slice(0, -1), { ...last, durationMin: last.durationMin + extraMin }];
}

/** 複数サービスのルールを保守的に統合（最も厳しい値を採用）。 */
function mergeRules(list: ResolvedBookingRules[]): ResolvedBookingRules {
  const first = list[0]!;
  return list.slice(1).reduce<ResolvedBookingRules>(
    (acc, r) => ({
      slotIntervalMin: Math.max(acc.slotIntervalMin, r.slotIntervalMin),
      bookingWindowDays: Math.min(acc.bookingWindowDays, r.bookingWindowDays),
      leadTimeMinHours: Math.max(acc.leadTimeMinHours, r.leadTimeMinHours),
      cancellationDeadlineHours: Math.max(acc.cancellationDeadlineHours, r.cancellationDeadlineHours),
      shopCapacity: Math.min(acc.shopCapacity, r.shopCapacity),
      serviceCapacity: Math.min(acc.serviceCapacity, r.serviceCapacity),
      staffCapacity: Math.min(acc.staffCapacity, r.staffCapacity),
    }),
    first,
  );
}

/**
 * コンボ予約のコンテキストを構築する。
 * - 各サービスの存在/公開を検証し、リクエスト順に読み込む
 * - 選択オプションを検証（対象サービスに属する active なもの以外はエラー）
 * - 延長オプションを占有セグメントへ反映
 * - 担当可能スタッフは全サービスの共通集合
 */
async function loadComboContext(
  db: DbClient,
  tenantId: string,
  shopId: string,
  items: ServiceItemInput[],
  staffId: string | null,
): Promise<ComboContext> {
  if (items.length === 0) throw Errors.validation('サービスを選択してください。');
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.serviceId)) {
      throw Errors.validation('同じメニューを複数回選択することはできません。');
    }
    seen.add(it.serviceId);
  }

  const contexts: ServiceContext[] = [];
  for (const it of items) {
    const ctx = await loadServiceContext(db, tenantId, shopId, it.serviceId);
    if (!ctx) throw Errors.notFound('店舗またはサービスが見つかりません。');
    contexts.push(ctx);
  }
  const shop = contexts[0]!.shop;

  // オプション検証（一括ロード）。オプションは自身の serviceId でサービスへ自動的に割り当てる
  // （GET クエリのフラットな optionIds でも、POST の per-item 指定でも同じ結果になる）。
  const allOptionIds = [...new Set(items.flatMap((it) => it.optionIds ?? []))];
  const optionRows = await loadSelectedOptions(
    db,
    tenantId,
    items.map((it) => it.serviceId),
    allOptionIds,
  );
  const optionById = new Map(optionRows.map((o) => [o.id, o]));
  for (const id of allOptionIds) {
    if (!optionById.has(id)) throw Errors.validation('選択されたオプションが無効です。');
  }

  const services: ComboContext['services'] = [];
  const parts: ChainPart[] = [];
  const rulesList: ResolvedBookingRules[] = [];

  for (let i = 0; i < items.length; i++) {
    const ctx = contexts[i]!;
    const options = optionRows.filter((o) => o.serviceId === ctx.service.id);
    const extraMin = options.reduce((a, o) => a + o.extraDurationMin, 0);
    const optionTotal = options.reduce((a, o) => a + o.priceJpy, 0);
    const segments = applyExtraMinutes(ctx.service.segments, extraMin);

    services.push({
      ...ctx.service,
      options,
      subtotalJpy: ctx.service.priceJpy + optionTotal,
    });
    const svcRules = resolveRules(ctx, staffId);
    rulesList.push(svcRules);
    parts.push({
      serviceId: ctx.service.id,
      segments,
      bufferBeforeMin: ctx.service.bufferBeforeMin,
      bufferAfterMin: ctx.service.bufferAfterMin,
      capacity: svcRules.serviceCapacity,
    });
  }

  // 全サービス共通で担当できるスタッフ（最初のサービスの順序を維持）
  const candidateStaffIds = contexts.reduce<string[]>(
    (acc, ctx) => acc.filter((id) => ctx.serviceStaffIds.includes(id)),
    contexts[0]!.serviceStaffIds,
  );

  return {
    shop,
    services,
    parts,
    candidateStaffIds,
    requiresStaff: contexts.some((c) => c.service.requiresStaff),
    rules: mergeRules(rulesList),
  };
}

// ---- 可用性問い合わせ ----

export interface AvailabilityParams {
  tenantId: string;
  shopId: string;
  /** 単一サービス（後方互換）。serviceItems 指定時は無視 */
  serviceId?: string;
  /** コンボ予約: リクエスト順に連続実施するサービス群（+オプション） */
  serviceItems?: ServiceItemInput[];
  staffId?: string | null;
  /** 店舗ローカル暦日 yyyy-MM-dd */
  date: string;
  /** 改期プレビュー用: この予約自身の占有を空き判定から除外 */
  excludeBookingId?: string;
  now?: Date;
}

export interface DayAvailability {
  date: string;
  timeZone: string;
  dayStatus: string;
  slots: SlotAvailability[];
}

function normalizeServiceItems(params: {
  serviceId?: string;
  serviceItems?: ServiceItemInput[];
}): ServiceItemInput[] {
  if (params.serviceItems && params.serviceItems.length > 0) return params.serviceItems;
  if (params.serviceId) return [{ serviceId: params.serviceId }];
  throw Errors.validation('サービスを選択してください。');
}

/** 指定日のスロット可用性を返す（公開予約ページ/管理画面が使用）。 */
export async function getDayAvailability(
  params: AvailabilityParams,
  db: DbClient = prisma,
): Promise<{ date: string; timeZone: string; dayStatus: string; slots: SlotAvailability[] }> {
  const { tenantId, shopId, date } = params;
  const staffId = params.staffId ?? null;
  const now = params.now ?? nowUtc();
  const items = normalizeServiceItems(params);

  const combo = await loadComboContext(db, tenantId, shopId, items, staffId);
  const tz = combo.shop.timezone;

  const relevantStaffIds = staffId ? [staffId] : combo.candidateStaffIds;
  const dayCtx = await loadDayContext(db, tenantId, shopId, date, relevantStaffIds);

  const { dayStatus, openIntervals } = resolveOpenIntervalsForDate({
    date,
    timeZone: tz,
    businessHours: dayCtx.businessHours,
    specialDay: dayCtx.specialDay,
    isNationalHoliday: dayCtx.isNationalHoliday,
    closeOnNationalHolidays: combo.shop.closeOnNationalHolidays,
  });

  if (openIntervals.length === 0) {
    return { date, timeZone: tz, dayStatus, slots: [] };
  }

  const staffWorkingIntervals = resolveStaffWorkingIntervals({
    date,
    timeZone: tz,
    staffIds: relevantStaffIds,
    schedules: dayCtx.schedules,
  });

  // その日の占有（店舗全体, active）
  const dayStartUtc = zonedDateMinutesToUtc(date, 0, tz);
  const dayEndUtc = zonedDateMinutesToUtc(date, 24 * 60, tz);
  const occupied = await loadOccupiedForDay(db, shopId, dayStartUtc, dayEndUtc, params.excludeBookingId);

  const first = combo.parts[0]!;
  const slots = computeAvailability({
    serviceId: first.serviceId,
    date,
    timeZone: tz,
    openIntervals,
    dayStatus,
    segments: first.segments,
    bufferBeforeMin: first.bufferBeforeMin,
    bufferAfterMin: first.bufferAfterMin,
    services: combo.parts,
    rules: combo.rules,
    staffId,
    candidateStaffIds: combo.requiresStaff ? combo.candidateStaffIds : [],
    staffWorkingIntervals,
    occupied,
    now,
  });

  return { date, timeZone: tz, dayStatus, slots };
}

export type DateAvailabilityStatus = 'OPEN' | 'FEW' | 'FULL' | 'CLOSED';

export interface DateSummaryParams {
  tenantId: string;
  shopId: string;
  serviceId?: string;
  serviceItems?: ServiceItemInput[];
  staffId?: string | null;
  fromDate: string; // yyyy-MM-dd
  days: number;
  now?: Date;
}

/**
 * 日付ストリップ用の空き状況サマリ（○△×）。getDayAvailability と同じエンジンを使い、
 * 範囲データを一括ロードして各日を in-memory で計算する（範囲長に依らず数クエリ）。
 *  - CLOSED: 休業/定休  - FULL: 予約可能枠ゼロ  - FEW: 残少  - OPEN: 余裕あり
 */
export async function getDateAvailabilitySummary(
  params: DateSummaryParams,
  db: DbClient = prisma,
): Promise<{ date: string; status: DateAvailabilityStatus }[]> {
  const staffId = params.staffId ?? null;
  const now = params.now ?? nowUtc();
  const items = normalizeServiceItems(params);

  const combo = await loadComboContext(db, params.tenantId, params.shopId, items, staffId);
  const tz = combo.shop.timezone;
  const relevantStaffIds = staffId ? [staffId] : combo.candidateStaffIds;

  const lastDateExclusive = isoDateAddDays(params.fromDate, params.days);
  const fromObj = new Date(`${params.fromDate}T00:00:00.000Z`);
  const toObj = new Date(`${lastDateExclusive}T00:00:00.000Z`);
  const rangeStartUtc = zonedDateMinutesToUtc(params.fromDate, 0, tz);
  const rangeEndUtc = zonedDateMinutesToUtc(lastDateExclusive, 0, tz);

  const [range, occupied] = await Promise.all([
    loadRangeContext(db, params.shopId, fromObj, toObj, relevantStaffIds),
    loadOccupiedOverlapping(db, params.shopId, rangeStartUtc, rangeEndUtc),
  ]);

  const FEW_THRESHOLD = 3;
  const out: { date: string; status: DateAvailabilityStatus }[] = [];

  for (let i = 0; i < params.days; i++) {
    const date = isoDateAddDays(params.fromDate, i);
    const { dayStatus, openIntervals } = resolveOpenIntervalsForDate({
      date,
      timeZone: tz,
      businessHours: range.businessHours,
      specialDay: range.specialDaysByDate.get(date) ?? null,
      isNationalHoliday: range.holidayDates.has(date),
      closeOnNationalHolidays: combo.shop.closeOnNationalHolidays,
    });

    if (openIntervals.length === 0) {
      out.push({ date, status: 'CLOSED' });
      continue;
    }

    const staffWorkingIntervals = resolveStaffWorkingIntervals({
      date,
      timeZone: tz,
      staffIds: relevantStaffIds,
      schedules: [...range.recurringSchedules, ...(range.overridesByDate.get(date) ?? [])],
    });
    const dayStartUtc = zonedDateMinutesToUtc(date, 0, tz);
    const dayEndUtc = zonedDateMinutesToUtc(date, 24 * 60, tz);
    const dayOccupied = occupied.filter((o) => o.start < dayEndUtc && o.end > dayStartUtc);

    const first = combo.parts[0]!;
    const slots = computeAvailability({
      serviceId: first.serviceId,
      date,
      timeZone: tz,
      openIntervals,
      dayStatus,
      segments: first.segments,
      bufferBeforeMin: first.bufferBeforeMin,
      bufferAfterMin: first.bufferAfterMin,
      services: combo.parts,
      rules: combo.rules,
      staffId,
      candidateStaffIds: combo.requiresStaff ? combo.candidateStaffIds : [],
      staffWorkingIntervals,
      occupied: dayOccupied,
      now,
    });

    const availCount = slots.filter((s) => s.available).length;
    out.push({
      date,
      status: availCount === 0 ? 'FULL' : availCount <= FEW_THRESHOLD ? 'FEW' : 'OPEN',
    });
  }

  return out;
}

// ---- 予約作成（防超卖の中核） ----

export interface CreateBookingInput {
  tenantId: string;
  shopId: string;
  /** 単一サービス（後方互換）。serviceItems 指定時は無視 */
  serviceId?: string;
  /** コンボ予約: リクエスト順に連続実施（各サービスにオプション選択可） */
  serviceItems?: ServiceItemInput[];
  /** null = おまかせ */
  staffId?: string | null;
  /** 最初のサービスの開始時刻（UTC instant） */
  startAt: Date;
  customer: {
    name: string;
    nameKana?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  note?: string | null;
  partySize?: number;
  source?: 'PUBLIC' | 'ADMIN' | 'IMPORT';
  idempotencyKey?: string | null;
  createdByUserId?: string | null;
  /** LINE(LIFF) 経由予約の顧客 userId。あれば確認/リマインドを LINE で送る（メールの代わり）。 */
  lineUserId?: string | null;
  now?: Date;
}

export interface CreateBookingResult {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  staffId: string | null;
  cancellationToken: string;
  totalPriceJpy: number;
  idempotentReplay: boolean;
}

/**
 * リマインダーの送信予定時刻（前日同時刻）を求める。
 *
 * 予約開始時刻は slotIntervalMin（既定15分）に量子化されているため、単純に
 * 「開始 - 24時間」にすると同一時刻に大量のリマインダーが集中する。
 * スイープは scheduledAt 昇順・優先度なしのため、その直後に発生した
 * 予約確認メールがリマインダーの山の後ろに回り、配信が数十秒〜数分遅れる。
 * 0〜30分のジッターを引いて山を崩す（前日リマインドとしての意味は変わらない）。
 */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const REMINDER_JITTER_MAX_MS = 30 * 60 * 1000;

function reminderScheduledAt(startAt: Date): Date {
  const jitter = randomInt(0, REMINDER_JITTER_MAX_MS);
  return new Date(startAt.getTime() - REMINDER_LEAD_MS - jitter);
}

const REASON_TO_ERROR: Record<SlotUnavailableReason, { code: AppErrorCode; msg: string }> = {
  SLOT_FULL: { code: 'SLOT_FULL', msg: '申し訳ございません。ご希望の時間帯は満席です。' },
  OUTSIDE_BUSINESS_HOURS: { code: 'OUTSIDE_BUSINESS_HOURS', msg: '選択された時間は営業時間外です。' },
  STAFF_UNAVAILABLE: {
    code: 'STAFF_UNAVAILABLE',
    msg: '指名のスタッフはこの時間帯はご対応できません。',
  },
  LEAD_TIME_VIOLATION: {
    code: 'LEAD_TIME_VIOLATION',
    msg: '予約受付の締切時刻を過ぎています。別の時間をお選びください。',
  },
  BOOKING_WINDOW_EXCEEDED: {
    code: 'BOOKING_WINDOW_EXCEEDED',
    msg: '予約可能な期間を超えています。',
  },
};

function reasonError(reason: SlotUnavailableReason | undefined) {
  const m = reason ? REASON_TO_ERROR[reason] : REASON_TO_ERROR.SLOT_FULL;
  return Errors.conflict(m.code, m.msg);
}

/** Postgres 排他制約違反(23P01)等を判定。 */
function isExclusionViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('booking_items_no_staff_overlap') ||
    msg.includes('23P01') ||
    msg.includes('exclusion constraint')
  );
}

/**
 * 店長向け通知ジョブをアウトボックスへ投入（同一トランザクション内）。
 * 店舗の有効な通知先（メール/LINE）ごとに1件。payload.audience=MANAGER で顧客通知と区別。
 */
async function enqueueManagerJobs(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    shopId: string;
    bookingId: string;
    template: 'BOOKING_CONFIRMED' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLED';
    event: 'CREATED' | 'RESCHEDULED' | 'CANCELLED';
  },
): Promise<void> {
  const recipients = await tx.notificationRecipient.findMany({
    where: { shopId: params.shopId, active: true },
    select: { channel: true, address: true },
  });
  for (const r of recipients) {
    if (!r.address) continue;
    await tx.notificationJob.create({
      data: {
        tenantId: params.tenantId,
        bookingId: params.bookingId,
        channel: r.channel,
        template: params.template,
        recipient: r.address,
        status: 'PENDING',
        payload: { bookingId: params.bookingId, audience: 'MANAGER', event: params.event },
      },
    });
  }
}

/**
 * 予約を作成する。並行下でもオーバーブッキングしない。
 * 失敗時は AppError（SLOT_FULL 等）を投げる。
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const now = input.now ?? nowUtc();
  const staffIdReq = input.staffId ?? null;
  const partySize = input.partySize ?? 1;

  // 二重送信防止: 既存の idempotencyKey があれば再生して返す
  // （テナント/店舗でスコープ: 別テナントのキー衝突・探索で他人の予約や cancellationToken を返さない）
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findFirst({
      where: { idempotencyKey: input.idempotencyKey, tenantId: input.tenantId, shopId: input.shopId },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        staffId: true,
        cancellationToken: true,
        totalPriceJpy: true,
      },
    });
    if (existing) return { ...existing, idempotentReplay: true };
  }

  // プランの月間予約上限（猶予帯あり）。オンライン予約(PUBLIC)のみ対象＝後台/取込は常に許可。
  // 冪等リプレイの後に置くのが要点: 既存予約のリトライを「新規1件」と誤カウントして
  // 上限直下のリトライを弾かないようにする（リプレイは上で return 済み）。
  if ((input.source ?? 'PUBLIC') === 'PUBLIC') {
    await assertPublicBookingQuota(input.tenantId, now);
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        const items = normalizeServiceItems(input);
        const combo = await loadComboContext(tx, input.tenantId, input.shopId, items, staffIdReq);

        const tz = combo.shop.timezone;
        const localDate = zonedDateString(input.startAt, tz);

        // 指名スタッフの検証 + 指名料（指名時のみ加算。おまかせ自動割当には掛からない）
        let nominationFeeJpy = 0;
        if (staffIdReq) {
          const staffRow = await tx.staff.findFirst({
            where: {
              id: staffIdReq,
              shopId: input.shopId,
              tenantId: input.tenantId,
              status: 'ACTIVE',
              isBookable: true,
              deletedAt: null,
            },
            select: { nominationFeeJpy: true },
          });
          if (!staffRow) throw Errors.notFound('指名されたスタッフが見つかりません。');
          nominationFeeJpy = staffRow.nominationFeeJpy;
          // 指名スタッフは選択された全サービスを担当できること
          if (combo.requiresStaff && !combo.candidateStaffIds.includes(staffIdReq)) {
            throw reasonError('STAFF_UNAVAILABLE');
          }
        }

        // (1) advisory lock: (店舗, 暦日) を直列化 — これ以降の読み取り/判定は権威的
        await acquireBookingLock(tx, input.shopId, localDate);

        const rules = combo.rules;
        const relevantStaffIds = staffIdReq ? [staffIdReq] : combo.candidateStaffIds;
        const dayCtx = await loadDayContext(tx, input.tenantId, input.shopId, localDate, relevantStaffIds);

        const { dayStatus, openIntervals } = resolveOpenIntervalsForDate({
          date: localDate,
          timeZone: tz,
          businessHours: dayCtx.businessHours,
          specialDay: dayCtx.specialDay,
          isNationalHoliday: dayCtx.isNationalHoliday,
          closeOnNationalHolidays: combo.shop.closeOnNationalHolidays,
        });
        if (openIntervals.length === 0) {
          throw reasonError('OUTSIDE_BUSINESS_HOURS');
        }

        const staffWorkingIntervals = resolveStaffWorkingIntervals({
          date: localDate,
          timeZone: tz,
          staffIds: relevantStaffIds,
          schedules: dayCtx.schedules,
        });

        // 占有計算（候補、チェーン全体）
        const occ = computeChainOccupancy({
          startAt: input.startAt,
          parts: combo.parts,
          staffId: staffIdReq,
        });

        // (2) ロック後に占有を読み直して容量を再判定（権威チェック）
        const occupied = await loadOccupiedOverlapping(
          tx,
          input.shopId,
          occ.occupiedStartAt,
          occ.occupiedEndAt,
        );

        const firstPart = combo.parts[0]!;
        const slots = computeAvailability({
          serviceId: firstPart.serviceId,
          date: localDate,
          timeZone: tz,
          openIntervals,
          dayStatus,
          segments: firstPart.segments,
          bufferBeforeMin: firstPart.bufferBeforeMin,
          bufferAfterMin: firstPart.bufferAfterMin,
          services: combo.parts,
          rules,
          staffId: staffIdReq,
          candidateStaffIds: combo.requiresStaff ? combo.candidateStaffIds : [],
          staffWorkingIntervals,
          occupied,
          now,
        });

        const slot = slots.find((s) => s.startAt.getTime() === input.startAt.getTime());
        if (!slot) {
          // 営業時間内だが刻みに合わない / 区間に収まらない
          throw reasonError('OUTSIDE_BUSINESS_HOURS');
        }
        if (!slot.available) {
          throw reasonError(slot.reason);
        }

        // (3) おまかせならスタッフ割当（全サービスを通しで担当できること）
        let assignedStaffId = staffIdReq;
        if (!assignedStaffId && combo.requiresStaff) {
          const newSegments = occ.intervals.map((i) => ({ start: i.start, end: i.end }));
          const free = findAvailableStaff({
            candidateStaffIds: combo.candidateStaffIds,
            staffWorkingIntervals,
            occupied,
            newSegments,
            serviceStart: input.startAt,
            serviceEnd: occ.serviceEndAt,
            staffCapacity: rules.staffCapacity,
          });
          if (free.length === 0) throw reasonError('STAFF_UNAVAILABLE');
          assignedStaffId = free[0]!;
        }

        // 割当スタッフで占有を確定
        const finalOcc = computeChainOccupancy({
          startAt: input.startAt,
          parts: combo.parts,
          staffId: assignedStaffId,
        });

        // 顧客（既存 email があれば再利用、なければ作成）
        let customerId: string | null = null;
        if (input.customer.email) {
          const existing = await tx.customer.findFirst({
            where: { tenantId: input.tenantId, email: input.customer.email, deletedAt: null },
            select: { id: true },
          });
          customerId = existing?.id ?? null;
        }
        if (!customerId) {
          const created = await tx.customer.create({
            data: {
              tenantId: input.tenantId,
              shopId: input.shopId,
              name: input.customer.name,
              nameKana: input.customer.nameKana ?? null,
              email: input.customer.email ?? null,
              phone: input.customer.phone ?? null,
            },
            select: { id: true },
          });
          customerId = created.id;
        }

        // 価格: Σ(サービス + オプション) × 人数 + 指名料
        const servicesSubtotal = combo.services.reduce((a, s) => a + s.subtotalJpy, 0);
        const totalPriceJpy = servicesSubtotal * partySize + nominationFeeJpy;

        // 明細: サービスごとの占有区間をチェーン順に展開。
        // 各サービスの先頭区間に小計とオプションのスナップショットを付ける。
        let sortOrder = 0;
        const itemCreates = finalOcc.parts.flatMap((part, pi) => {
          const svc = combo.services[pi]!;
          return part.intervals.map((iv, idx) => ({
            tenantId: input.tenantId,
            shopId: input.shopId,
            serviceId: part.serviceId,
            staffId: assignedStaffId,
            startAt: iv.start,
            endAt: iv.end,
            serviceEndAt: part.serviceEndAt,
            bufferAfterMin: idx === part.intervals.length - 1 ? svc.bufferAfterMin : 0,
            priceJpy: idx === 0 ? svc.subtotalJpy : 0,
            active: true,
            sortOrder: sortOrder++,
            ...(idx === 0 && svc.options.length > 0
              ? {
                  options: {
                    create: svc.options.map((o) => ({
                      optionId: o.id,
                      name: o.name,
                      priceJpy: o.priceJpy,
                      extraDurationMin: o.extraDurationMin,
                    })),
                  },
                }
              : {}),
          }));
        });

        // (4) 予約 + 明細 + イベント を挿入。排他制約が最終防御線。
        const booking = await tx.booking.create({
          data: {
            tenantId: input.tenantId,
            shopId: input.shopId,
            customerId,
            serviceId: combo.services[0]!.id,
            staffId: assignedStaffId,
            status: 'CONFIRMED',
            source: input.source ?? 'PUBLIC',
            startAt: input.startAt,
            endAt: finalOcc.occupiedEndAt,
            partySize,
            totalPriceJpy,
            nominationFeeJpy,
            customerName: input.customer.name,
            customerEmail: input.customer.email ?? null,
            customerPhone: input.customer.phone ?? null,
            customerLineUserId: input.lineUserId ?? null,
            note: input.note ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            confirmedAt: now,
            createdByUserId: input.createdByUserId ?? null,
            items: { create: itemCreates },
            events: {
              create: {
                tenantId: input.tenantId,
                type: 'CREATED',
                toStatus: 'CONFIRMED',
                actorType: input.source === 'ADMIN' ? 'USER' : 'CUSTOMER',
                actorId: input.createdByUserId ?? null,
                payload: {
                  staffId: assignedStaffId,
                  startAt: input.startAt.toISOString(),
                  serviceIds: combo.services.map((s) => s.id),
                },
              },
            },
          },
          select: {
            id: true,
            status: true,
            startAt: true,
            endAt: true,
            staffId: true,
            cancellationToken: true,
            totalPriceJpy: true,
          },
        });

        // (5) 通知アウトボックス（PENDING）。実送信は worker が担当。
        // LINE(LIFF) 経由予約は LINE で、それ以外はメールで顧客へ確認/リマインド（重複送信しない）。
        const custChannel = input.lineUserId ? 'LINE' : 'EMAIL';
        const custRecipient = input.lineUserId ?? input.customer.email ?? '';
        await tx.notificationJob.create({
          data: {
            tenantId: input.tenantId,
            bookingId: booking.id,
            channel: custChannel,
            template: 'BOOKING_CONFIRMED',
            recipient: custRecipient,
            status: 'PENDING',
            payload: { bookingId: booking.id },
          },
        });

        // リマインドを開始24時間前にスケジュール（未来かつ宛先ありのとき）。
        // worker のアウトボックス掃き出しが scheduledAt<=now のみ処理するため、時刻到来まで送られない。
        const reminderAt = reminderScheduledAt(input.startAt);
        if (custRecipient && reminderAt.getTime() > now.getTime()) {
          await tx.notificationJob.create({
            data: {
              tenantId: input.tenantId,
              bookingId: booking.id,
              channel: custChannel,
              template: 'BOOKING_REMINDER',
              recipient: custRecipient,
              status: 'PENDING',
              scheduledAt: reminderAt,
              payload: { bookingId: booking.id, kind: 'reminder' },
            },
          });
        }

        // 店長向け通知（新規予約）
        await enqueueManagerJobs(tx, {
          tenantId: input.tenantId,
          shopId: input.shopId,
          bookingId: booking.id,
          template: 'BOOKING_CONFIRMED',
          event: 'CREATED',
        });

        return { ...booking, idempotentReplay: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    );
  } catch (e) {
    // idempotencyKey の競合 → 既存を返す
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      input.idempotencyKey
    ) {
      const existing = await prisma.booking.findFirst({
        where: { idempotencyKey: input.idempotencyKey, tenantId: input.tenantId, shopId: input.shopId },
        select: {
          id: true,
          status: true,
          startAt: true,
          endAt: true,
          staffId: true,
          cancellationToken: true,
          totalPriceJpy: true,
        },
      });
      if (existing) return { ...existing, idempotentReplay: true };
    }
    // 排他制約違反（スタッフ二重予約のレース）→ 満席として返す
    if (isExclusionViolation(e)) {
      throw reasonError('SLOT_FULL');
    }
    throw e;
  }
}

// ---- 予約照会・キャンセル ----

export interface BookingLineItem {
  serviceName: string;
  priceJpy: number;
  options: { name: string; priceJpy: number }[];
}

export interface BookingDetail {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  serviceName: string;
  /** サービスごとの内訳（コンボ/オプション対応） */
  lineItems: BookingLineItem[];
  nominationFeeJpy: number;
  staffName: string | null;
  shopName: string;
  shopSlug: string;
  timezone: string;
  customerName: string;
  totalPriceJpy: number;
  cancellationToken: string;
  cancellable: boolean;
  cancellationDeadlineHours: number;
}

async function loadCancellationDeadlineHours(
  shopId: string,
  serviceId: string,
): Promise<number> {
  const rules = await prisma.bookingCapacityRule.findMany({
    where: { shopId, isActive: true, OR: [{ scope: 'SHOP' }, { scope: 'SERVICE', serviceId }] },
    select: { scope: true, cancellationDeadlineHours: true },
  });
  const svc = rules.find((r) => r.scope === 'SERVICE');
  const shop = rules.find((r) => r.scope === 'SHOP');
  return svc?.cancellationDeadlineHours ?? shop?.cancellationDeadlineHours ?? 24;
}

/** キャンセルトークンから予約詳細を取得（公開キャンセルページ用）。 */
export async function getBookingByToken(
  token: string,
  now: Date = nowUtc(),
): Promise<BookingDetail> {
  const b = await prisma.booking.findUnique({
    where: { cancellationToken: token },
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      totalPriceJpy: true,
      nominationFeeJpy: true,
      customerName: true,
      cancellationToken: true,
      serviceId: true,
      shopId: true,
      service: { select: { name: true } },
      staff: { select: { name: true, displayName: true } },
      shop: { select: { name: true, slug: true, timezone: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          priceJpy: true,
          service: { select: { id: true, name: true } },
          options: { select: { name: true, priceJpy: true } },
        },
      },
    },
  });
  if (!b) throw Errors.notFound('予約が見つかりませんでした。');

  const deadlineHours = await loadCancellationDeadlineHours(b.shopId, b.serviceId);
  const cancellable =
    (b.status === 'CONFIRMED' || b.status === 'PENDING') &&
    isCancellable(b.startAt, now, deadlineHours);

  // サービスごとの内訳（各サービスの先頭 item に小計とオプションが載っている）
  const lineItems: BookingLineItem[] = [];
  const seenServices = new Set<string>();
  for (const it of b.items) {
    if (seenServices.has(it.service.id)) continue;
    seenServices.add(it.service.id);
    // item.priceJpy はサービス小計（本体+オプション）。表示用に本体価格へ分解する
    const optionsTotal = it.options.reduce((a, o) => a + o.priceJpy, 0);
    lineItems.push({
      serviceName: it.service.name,
      priceJpy: it.priceJpy - optionsTotal,
      options: it.options.map((o) => ({ name: o.name, priceJpy: o.priceJpy })),
    });
  }
  const serviceName =
    lineItems.length > 0 ? lineItems.map((li) => li.serviceName).join(' + ') : b.service.name;

  return {
    id: b.id,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    serviceName,
    lineItems,
    nominationFeeJpy: b.nominationFeeJpy,
    staffName: b.staff?.displayName ?? b.staff?.name ?? null,
    shopName: b.shop.name,
    shopSlug: b.shop.slug,
    timezone: b.shop.timezone,
    customerName: b.customerName,
    totalPriceJpy: b.totalPriceJpy,
    cancellationToken: b.cancellationToken,
    cancellable,
    cancellationDeadlineHours: deadlineHours,
  };
}

export interface CancelBookingInput {
  token: string;
  reason?: string | null;
  actorType?: 'CUSTOMER' | 'USER';
  actorId?: string | null;
  now?: Date;
}

/** 予約をキャンセル。期限超過・状態不正はエラー。占有は status 変更トリガで解放。 */
export async function cancelBooking(input: CancelBookingInput): Promise<{ id: string; status: string }> {
  const now = input.now ?? nowUtc();

  return prisma.$transaction(async (tx) => {
    const b = await tx.booking.findUnique({
      where: { cancellationToken: input.token },
      select: { id: true, status: true, startAt: true, shopId: true, serviceId: true, tenantId: true, customerLineUserId: true },
    });
    if (!b) throw Errors.notFound('予約が見つかりませんでした。');

    if (b.status !== 'CONFIRMED' && b.status !== 'PENDING') {
      throw Errors.conflict('INVALID_BOOKING_STATE', 'この予約はキャンセルできません（既にキャンセル済みまたは完了済み）。');
    }

    const deadlineHours = await loadCancellationDeadlineHours(b.shopId, b.serviceId);
    if (!isCancellable(b.startAt, now, deadlineHours)) {
      throw Errors.conflict(
        'CANCELLATION_DEADLINE_PASSED',
        `キャンセル期限（開始の${deadlineHours}時間前）を過ぎているため、オンラインではキャンセルできません。店舗へご連絡ください。`,
      );
    }

    const updated = await tx.booking.update({
      where: { id: b.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: input.reason ?? null },
      select: { id: true, status: true },
    });
    // booking_items.active は status 変更トリガで false に同期される（占有解放）

    // 未送信のリマインドを無効化（キャンセル済みにリマインドを送らない）
    await tx.notificationJob.updateMany({
      where: { bookingId: b.id, template: 'BOOKING_REMINDER', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    await tx.bookingEvent.create({
      data: {
        tenantId: b.tenantId,
        bookingId: b.id,
        type: 'CANCELLED',
        fromStatus: b.status,
        toStatus: 'CANCELLED',
        actorType: input.actorType ?? 'CUSTOMER',
        actorId: input.actorId ?? null,
        payload: { reason: input.reason ?? null },
      },
    });

    // LINE 経由予約はキャンセル確認を LINE で顧客へ。非 LINE は従来どおり（顧客メール確認は送らない）。
    await tx.notificationJob.create({
      data: {
        tenantId: b.tenantId,
        bookingId: b.id,
        channel: b.customerLineUserId ? 'LINE' : 'EMAIL',
        template: 'BOOKING_CANCELLED',
        recipient: b.customerLineUserId ?? '',
        status: 'PENDING',
        payload: { bookingId: b.id },
      },
    });

    // 店長向け通知（キャンセル）
    await enqueueManagerJobs(tx, {
      tenantId: b.tenantId,
      shopId: b.shopId,
      bookingId: b.id,
      template: 'BOOKING_CANCELLED',
      event: 'CANCELLED',
    });

    return updated;
  });
}

// ---- 予約変更（改期）----

/** 顧客の自助改期用: token から予約の構成（サービス/担当/店舗）を解決。 */
export async function getBookingRescheduleContextByToken(token: string) {
  const b = await prisma.booking.findUnique({
    where: { cancellationToken: token },
    select: {
      id: true,
      tenantId: true,
      shopId: true,
      status: true,
      staffId: true,
      shop: { select: { timezone: true } },
      items: { orderBy: { sortOrder: 'asc' }, select: { serviceId: true, options: { select: { optionId: true } } } },
    },
  });
  if (!b) throw Errors.notFound('予約が見つかりませんでした。');
  const seen = new Set<string>();
  const serviceItems: ServiceItemInput[] = [];
  for (const it of b.items) {
    if (seen.has(it.serviceId)) continue;
    seen.add(it.serviceId);
    serviceItems.push({ serviceId: it.serviceId, optionIds: it.options.map((o) => o.optionId).filter((x): x is string => !!x) });
  }
  return { bookingId: b.id, tenantId: b.tenantId, shopId: b.shopId, timezone: b.shop.timezone, staffId: b.staffId, status: b.status, serviceItems };
}


export interface RescheduleBookingInput {
  bookingId: string;
  newStartAt: Date;
  /** undefined=担当を維持 / null=おまかせ再割当 / string=指名 */
  newStaffId?: string | null;
  actorType: 'USER' | 'CUSTOMER';
  actorUserId?: string | null;
  /** 顧客の自助変更では変更期限（=キャンセル期限）を強制する */
  enforceDeadline?: boolean;
  now?: Date;
}
export interface RescheduleBookingResult {
  id: string;
  status: string;
  startAt: Date;
  endAt: Date;
  staffId: string | null;
}

/**
 * 既存予約を新しい日時（と任意で担当）へ移動する。占有はロック内で原子的に付け替える。
 * 料金/指名料は据え置き（時間変更であり再注文ではないため）。並行下でもオーバーブッキングしない。
 */
export async function rescheduleBooking(input: RescheduleBookingInput): Promise<RescheduleBookingResult> {
  const now = input.now ?? nowUtc();
  try {
    return await prisma.$transaction(
      async (tx) => {
        const b = await tx.booking.findFirst({
          where: { id: input.bookingId, deletedAt: null },
          select: {
            id: true, tenantId: true, shopId: true, status: true, startAt: true, staffId: true,
            serviceId: true, customerEmail: true, customerLineUserId: true,
            shop: { select: { timezone: true, closeOnNationalHolidays: true } },
            items: { orderBy: { sortOrder: 'asc' }, select: { serviceId: true, options: { select: { optionId: true } } } },
          },
        });
        if (!b) throw Errors.notFound('予約が見つかりません。');
        if (b.status !== 'CONFIRMED' && b.status !== 'PENDING') {
          throw Errors.conflict('INVALID_BOOKING_STATE', 'この予約は変更できません（既にキャンセル/完了済み）。');
        }
        if (input.enforceDeadline) {
          const deadlineHours = await loadCancellationDeadlineHours(b.shopId, b.serviceId);
          if (!isCancellable(b.startAt, now, deadlineHours)) {
            throw Errors.conflict('CANCELLATION_DEADLINE_PASSED', `変更期限（開始の${deadlineHours}時間前）を過ぎています。店舗へご連絡ください。`);
          }
        }

        // 既存明細から予約構成（サービス順 + オプション）を復元
        const seen = new Set<string>();
        const serviceItems: ServiceItemInput[] = [];
        for (const it of b.items) {
          if (seen.has(it.serviceId)) continue;
          seen.add(it.serviceId);
          serviceItems.push({ serviceId: it.serviceId, optionIds: it.options.map((o) => o.optionId).filter((x): x is string => !!x) });
        }

        const tz = b.shop.timezone;
        const localDate = zonedDateString(input.newStartAt, tz);
        const staffIdReq = input.newStaffId === undefined ? b.staffId : input.newStaffId;

        const combo = await loadComboContext(tx, b.tenantId, b.shopId, serviceItems, staffIdReq);
        if (staffIdReq) {
          // createBooking と同じく、指名スタッフが当該店舗の実在・有効・予約可能な
          // スタッフであることを検証する。requiresStaff=false のサービスでも、外部/他店舗/
          // 停止・削除済みの staffId を割り当てられないようにする（改期経路の欠落だった）。
          const staffRow = await tx.staff.findFirst({
            where: {
              id: staffIdReq,
              shopId: b.shopId,
              tenantId: b.tenantId,
              status: 'ACTIVE',
              isBookable: true,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!staffRow) throw Errors.notFound('指名されたスタッフが見つかりません。');
          if (combo.requiresStaff && !combo.candidateStaffIds.includes(staffIdReq)) {
            throw reasonError('STAFF_UNAVAILABLE');
          }
        }

        // (1) advisory lock（店舗×新暦日）
        await acquireBookingLock(tx, b.shopId, localDate);

        // (1.5) 予約行をロックして状態を再確認。並行キャンセル/完了と直列化し、
        // 「CANCELLED なのに新明細が active」という幽霊占有を防ぐ。
        const cur = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${b.id} FOR UPDATE`;
        if (cur[0]?.status !== 'CONFIRMED' && cur[0]?.status !== 'PENDING') {
          throw Errors.conflict('INVALID_BOOKING_STATE', 'この予約は変更できません（既にキャンセル/完了済み）。');
        }

        // (2) 旧明細を削除して占有を解放（自己競合を防ぐ）。失敗時はロールバックで復元。
        await tx.bookingItem.deleteMany({ where: { bookingId: b.id } });

        const relevantStaffIds = staffIdReq ? [staffIdReq] : combo.candidateStaffIds;
        const dayCtx = await loadDayContext(tx, b.tenantId, b.shopId, localDate, relevantStaffIds);
        const { dayStatus, openIntervals } = resolveOpenIntervalsForDate({
          date: localDate,
          timeZone: tz,
          businessHours: dayCtx.businessHours,
          specialDay: dayCtx.specialDay,
          isNationalHoliday: dayCtx.isNationalHoliday,
          closeOnNationalHolidays: b.shop.closeOnNationalHolidays,
        });
        if (openIntervals.length === 0) throw reasonError('OUTSIDE_BUSINESS_HOURS');

        const staffWorkingIntervals = resolveStaffWorkingIntervals({ date: localDate, timeZone: tz, staffIds: relevantStaffIds, schedules: dayCtx.schedules });
        const occ = computeChainOccupancy({ startAt: input.newStartAt, parts: combo.parts, staffId: staffIdReq });
        const occupied = await loadOccupiedOverlapping(tx, b.shopId, occ.occupiedStartAt, occ.occupiedEndAt);

        const firstPart = combo.parts[0]!;
        const slots = computeAvailability({
          serviceId: firstPart.serviceId,
          date: localDate,
          timeZone: tz,
          openIntervals,
          dayStatus,
          segments: firstPart.segments,
          bufferBeforeMin: firstPart.bufferBeforeMin,
          bufferAfterMin: firstPart.bufferAfterMin,
          services: combo.parts,
          rules: combo.rules,
          staffId: staffIdReq,
          candidateStaffIds: combo.requiresStaff ? combo.candidateStaffIds : [],
          staffWorkingIntervals,
          occupied,
          now,
        });
        const slot = slots.find((s) => s.startAt.getTime() === input.newStartAt.getTime());
        if (!slot) throw reasonError('OUTSIDE_BUSINESS_HOURS');
        if (!slot.available) throw reasonError(slot.reason);

        // おまかせなら担当割当
        let assignedStaffId = staffIdReq;
        if (!assignedStaffId && combo.requiresStaff) {
          const newSegments = occ.intervals.map((i) => ({ start: i.start, end: i.end }));
          const free = findAvailableStaff({
            candidateStaffIds: combo.candidateStaffIds,
            staffWorkingIntervals,
            occupied,
            newSegments,
            serviceStart: input.newStartAt,
            serviceEnd: occ.serviceEndAt,
            staffCapacity: combo.rules.staffCapacity,
          });
          if (free.length === 0) throw reasonError('STAFF_UNAVAILABLE');
          assignedStaffId = free[0]!;
        }
        const finalOcc = computeChainOccupancy({ startAt: input.newStartAt, parts: combo.parts, staffId: assignedStaffId });

        // (3) 新明細を作成（createBooking と同形）
        let sortOrder = 0;
        const itemCreates = finalOcc.parts.flatMap((part, pi) => {
          const svc = combo.services[pi]!;
          return part.intervals.map((iv, idx) => ({
            tenantId: b.tenantId,
            shopId: b.shopId,
            serviceId: part.serviceId,
            staffId: assignedStaffId,
            startAt: iv.start,
            endAt: iv.end,
            serviceEndAt: part.serviceEndAt,
            bufferAfterMin: idx === part.intervals.length - 1 ? svc.bufferAfterMin : 0,
            priceJpy: idx === 0 ? svc.subtotalJpy : 0,
            active: true,
            sortOrder: sortOrder++,
            ...(idx === 0 && svc.options.length > 0
              ? { options: { create: svc.options.map((o) => ({ optionId: o.id, name: o.name, priceJpy: o.priceJpy, extraDurationMin: o.extraDurationMin })) } }
              : {}),
          }));
        });

        const updated = await tx.booking.update({
          where: { id: b.id },
          data: {
            startAt: input.newStartAt,
            endAt: finalOcc.occupiedEndAt,
            staffId: assignedStaffId,
            items: { create: itemCreates },
            events: {
              create: {
                tenantId: b.tenantId,
                type: 'RESCHEDULED',
                fromStatus: b.status,
                toStatus: b.status,
                actorType: input.actorType,
                actorId: input.actorUserId ?? null,
                payload: {
                  oldStartAt: b.startAt.toISOString(),
                  newStartAt: input.newStartAt.toISOString(),
                  oldStaffId: b.staffId,
                  newStaffId: assignedStaffId,
                },
              },
            },
          },
          select: { id: true, status: true, startAt: true, endAt: true, staffId: true },
        });

        // (4) リマインドを貼り直し + 変更通知
        await tx.notificationJob.updateMany({
          where: { bookingId: b.id, template: 'BOOKING_REMINDER', status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        // LINE 経由予約は LINE、それ以外はメールで顧客へ（重複送信しない）。
        const custChannel = b.customerLineUserId ? 'LINE' : 'EMAIL';
        const custRecipient = b.customerLineUserId ?? b.customerEmail ?? '';
        const reminderAt = reminderScheduledAt(input.newStartAt);
        if (custRecipient && reminderAt.getTime() > now.getTime()) {
          await tx.notificationJob.create({
            data: { tenantId: b.tenantId, bookingId: b.id, channel: custChannel, template: 'BOOKING_REMINDER', recipient: custRecipient, status: 'PENDING', scheduledAt: reminderAt, payload: { bookingId: b.id, kind: 'reminder' } },
          });
        }
        if (custRecipient) {
          await tx.notificationJob.create({
            data: { tenantId: b.tenantId, bookingId: b.id, channel: custChannel, template: 'BOOKING_RESCHEDULED', recipient: custRecipient, status: 'PENDING', payload: { bookingId: b.id } },
          });
        }

        // 店長向け通知（変更）
        await enqueueManagerJobs(tx, {
          tenantId: b.tenantId,
          shopId: b.shopId,
          bookingId: b.id,
          template: 'BOOKING_RESCHEDULED',
          event: 'RESCHEDULED',
        });

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 },
    );
  } catch (e) {
    if (isExclusionViolation(e)) throw reasonError('SLOT_FULL');
    throw e;
  }
}
