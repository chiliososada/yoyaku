/**
 * 予約まわりのデータアクセス（リポジトリ層）。
 * - すべて tenantId / shopId でスコープし、データ隔離を担保。
 * - DbClient（PrismaClient or トランザクション）を受け取り、サービス層がトランザクション境界を制御。
 * - ドメイン層が必要とする形（純粋データ）に整形して返す。
 */
import { prisma, type DbClient } from '@/lib/db';
import type {
  OccupancySegment,
  OccupiedInterval,
} from '@/domain/booking/types';
import type { ScheduleRow } from '@/domain/booking/schedules';
import type { BusinessHoursRow, SpecialDayInput } from '@/domain/booking/business-hours';
import { zonedDateString } from '@/lib/time';

export interface CapacityRuleRow {
  scope: 'SHOP' | 'SERVICE' | 'STAFF';
  serviceId: string | null;
  staffId: string | null;
  maxConcurrent: number;
  slotIntervalMin: number;
  bookingWindowDays: number;
  leadTimeMinHours: number;
  cancellationDeadlineHours: number;
}

export interface ServiceContext {
  shop: {
    id: string;
    tenantId: string;
    timezone: string;
    closeOnNationalHolidays: boolean;
    settings: Record<string, unknown>;
  };
  service: {
    id: string;
    name: string;
    durationMin: number;
    segments: OccupancySegment[];
    bufferBeforeMin: number;
    bufferAfterMin: number;
    capacity: number;
    slotIntervalMin: number;
    requiresStaff: boolean;
    priceJpy: number;
  };
  /** このサービスを担当可能な、予約対象スタッフID（active かつ bookable） */
  serviceStaffIds: string[];
  capacityRules: CapacityRuleRow[];
}

function parseSegments(raw: unknown, durationMin: number): OccupancySegment[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const segs = raw
      .map((s) => {
        const o = s as Record<string, unknown>;
        const offsetMin = Number(o.offsetMin);
        const dur = Number(o.durationMin);
        if (Number.isFinite(offsetMin) && Number.isFinite(dur) && dur > 0) {
          return { offsetMin, durationMin: dur };
        }
        return null;
      })
      .filter((x): x is OccupancySegment => x !== null);
    if (segs.length > 0) return segs;
  }
  return [{ offsetMin: 0, durationMin }];
}

/** サービス予約に必要な構成情報を読み込む（テナント/店舗スコープ）。 */
export async function loadServiceContext(
  db: DbClient,
  tenantId: string,
  shopId: string,
  serviceId: string,
): Promise<ServiceContext | null> {
  const shop = await db.shop.findFirst({
    where: { id: shopId, tenantId, deletedAt: null },
    select: {
      id: true,
      tenantId: true,
      timezone: true,
      closeOnNationalHolidays: true,
      settings: true,
    },
  });
  if (!shop) return null;

  const service = await db.service.findFirst({
    where: { id: serviceId, shopId, tenantId, deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      durationMin: true,
      segments: true,
      bufferBeforeMin: true,
      bufferAfterMin: true,
      capacity: true,
      slotIntervalMin: true,
      requiresStaff: true,
      priceJpy: true,
      salePriceJpy: true,
    },
  });
  if (!service) return null;

  const serviceStaff = await db.serviceStaff.findMany({
    where: {
      serviceId,
      staff: { shopId, tenantId, status: 'ACTIVE', isBookable: true, deletedAt: null },
    },
    select: { staffId: true },
  });

  const rules = await db.bookingCapacityRule.findMany({
    where: { shopId, tenantId, isActive: true },
    select: {
      scope: true,
      serviceId: true,
      staffId: true,
      maxConcurrent: true,
      slotIntervalMin: true,
      bookingWindowDays: true,
      leadTimeMinHours: true,
      cancellationDeadlineHours: true,
    },
  });

  return {
    shop: {
      id: shop.id,
      tenantId: shop.tenantId,
      timezone: shop.timezone,
      closeOnNationalHolidays: shop.closeOnNationalHolidays,
      settings: (shop.settings as Record<string, unknown>) ?? {},
    },
    service: {
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      segments: parseSegments(service.segments, service.durationMin),
      bufferBeforeMin: service.bufferBeforeMin,
      bufferAfterMin: service.bufferAfterMin,
      capacity: service.capacity,
      slotIntervalMin: service.slotIntervalMin,
      requiresStaff: service.requiresStaff,
      // 実際に請求する価格 = セール価格があればそれ、なければ通常価格
      priceJpy: service.salePriceJpy ?? service.priceJpy,
    },
    serviceStaffIds: serviceStaff.map((s) => s.staffId),
    capacityRules: rules as CapacityRuleRow[],
  };
}

export interface ServiceOptionRow {
  id: string;
  serviceId: string;
  name: string;
  priceJpy: number;
  extraDurationMin: number;
}

/** 選択されたオプションを検証つきで読み込む（対象サービスに属する active なもののみ）。 */
export async function loadSelectedOptions(
  db: DbClient,
  tenantId: string,
  serviceIds: string[],
  optionIds: string[],
): Promise<ServiceOptionRow[]> {
  if (optionIds.length === 0) return [];
  const rows = await db.serviceOption.findMany({
    where: {
      id: { in: optionIds },
      tenantId,
      serviceId: { in: serviceIds },
      isActive: true,
      deletedAt: null,
    },
    select: { id: true, serviceId: true, name: true, priceJpy: true, extraDurationMin: true },
  });
  return rows;
}

export interface DayContext {
  businessHours: BusinessHoursRow[];
  specialDay: SpecialDayInput | null;
  isNationalHoliday: boolean;
  schedules: ScheduleRow[];
}

/** ある暦日の営業/休業/シフト情報を読み込む。 */
export async function loadDayContext(
  db: DbClient,
  tenantId: string,
  shopId: string,
  date: string,
  staffIds: string[],
): Promise<DayContext> {
  const dateObj = new Date(`${date}T00:00:00.000Z`);

  const [businessHours, special, holiday, schedules] = await Promise.all([
    db.businessHours.findMany({
      where: { shopId },
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    db.specialBusinessDay.findFirst({
      where: { shopId, date: dateObj },
      select: { type: true, openMinute: true, closeMinute: true },
    }),
    db.holiday.findFirst({
      where: { type: 'NATIONAL', date: dateObj },
      select: { id: true },
    }),
    staffIds.length > 0
      ? db.staffSchedule.findMany({
          where: {
            shopId,
            staffId: { in: staffIds },
            OR: [{ type: 'RECURRING' }, { type: 'OVERRIDE', date: dateObj }],
          },
          select: {
            staffId: true,
            type: true,
            dayOfWeek: true,
            date: true,
            startMinute: true,
            endMinute: true,
            isWorking: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    businessHours,
    specialDay: special
      ? { type: special.type, openMinute: special.openMinute, closeMinute: special.closeMinute }
      : null,
    isNationalHoliday: Boolean(holiday),
    schedules: schedules.map((s) => ({
      staffId: s.staffId,
      type: s.type,
      dayOfWeek: s.dayOfWeek,
      date: s.date ? zonedDateString(s.date, 'UTC') : null,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      isWorking: s.isWorking,
    })),
  };
}

/** 指定区間に重なる active な占有（booking_items）を読み込む。容量再計算に使用。 */
export async function loadOccupiedOverlapping(
  db: DbClient,
  shopId: string,
  start: Date,
  end: Date,
  excludeBookingId?: string,
): Promise<OccupiedInterval[]> {
  const items = await db.bookingItem.findMany({
    where: {
      shopId,
      active: true,
      startAt: { lt: end },
      endAt: { gt: start },
      ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}),
    },
    select: { startAt: true, endAt: true, staffId: true, serviceId: true },
  });
  return items.map((i) => ({
    start: i.startAt,
    end: i.endAt,
    staffId: i.staffId,
    serviceId: i.serviceId,
  }));
}

/** 当日(店舗ローカル)の active な占有をすべて読み込む（availability 一覧用）。 */
export async function loadOccupiedForDay(
  db: DbClient,
  shopId: string,
  dayStartUtc: Date,
  dayEndUtc: Date,
  excludeBookingId?: string,
): Promise<OccupiedInterval[]> {
  return loadOccupiedOverlapping(db, shopId, dayStartUtc, dayEndUtc, excludeBookingId);
}

export interface RangeContext {
  businessHours: BusinessHoursRow[];
  /** yyyy-MM-dd -> 特別営業日 */
  specialDaysByDate: Map<string, SpecialDayInput>;
  /** 祝日の yyyy-MM-dd 集合 */
  holidayDates: Set<string>;
  recurringSchedules: ScheduleRow[];
  /** yyyy-MM-dd -> その日の OVERRIDE シフト */
  overridesByDate: Map<string, ScheduleRow[]>;
}

/**
 * 日付範囲の営業/休業/シフトを一括読み込み（日付ストリップの空き状況サマリ用）。
 * 範囲長に依らず数クエリで済むよう、業務時間・特別日・祝日・シフトをまとめて取得する。
 */
export async function loadRangeContext(
  db: DbClient,
  shopId: string,
  fromDateObj: Date,
  toDateObj: Date,
  staffIds: string[],
): Promise<RangeContext> {
  const [businessHours, specials, holidays, schedules] = await Promise.all([
    db.businessHours.findMany({
      where: { shopId },
      select: { dayOfWeek: true, openMinute: true, closeMinute: true },
    }),
    db.specialBusinessDay.findMany({
      where: { shopId, date: { gte: fromDateObj, lt: toDateObj } },
      select: { date: true, type: true, openMinute: true, closeMinute: true },
    }),
    db.holiday.findMany({
      where: { type: 'NATIONAL', date: { gte: fromDateObj, lt: toDateObj } },
      select: { date: true },
    }),
    staffIds.length > 0
      ? db.staffSchedule.findMany({
          where: {
            shopId,
            staffId: { in: staffIds },
            OR: [{ type: 'RECURRING' }, { type: 'OVERRIDE', date: { gte: fromDateObj, lt: toDateObj } }],
          },
          select: {
            staffId: true,
            type: true,
            dayOfWeek: true,
            date: true,
            startMinute: true,
            endMinute: true,
            isWorking: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const specialDaysByDate = new Map<string, SpecialDayInput>();
  for (const s of specials) {
    specialDaysByDate.set(zonedDateString(s.date, 'UTC'), {
      type: s.type,
      openMinute: s.openMinute,
      closeMinute: s.closeMinute,
    });
  }
  const holidayDates = new Set(holidays.map((h) => zonedDateString(h.date, 'UTC')));
  const recurringSchedules: ScheduleRow[] = [];
  const overridesByDate = new Map<string, ScheduleRow[]>();
  for (const s of schedules) {
    const row: ScheduleRow = {
      staffId: s.staffId,
      type: s.type,
      dayOfWeek: s.dayOfWeek,
      date: s.date ? zonedDateString(s.date, 'UTC') : null,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      isWorking: s.isWorking,
    };
    if (s.type === 'RECURRING') {
      recurringSchedules.push(row);
    } else if (row.date) {
      const arr = overridesByDate.get(row.date) ?? [];
      arr.push(row);
      overridesByDate.set(row.date, arr);
    }
  }

  return { businessHours, specialDaysByDate, holidayDates, recurringSchedules, overridesByDate };
}

/**
 * (店舗, 暦日) 単位の advisory transaction lock を取得。
 * 同一店舗・同一日への並行予約を直列化し、容量再カウントの原子性を保証する。
 * トランザクション終了時に自動解放。
 */
export async function acquireBookingLock(
  tx: DbClient,
  shopId: string,
  localDate: string,
): Promise<void> {
  const key = `booking:${shopId}:${localDate}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export { prisma };
