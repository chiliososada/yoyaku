/**
 * 商家後台の読み取りサービス。すべて tenantId でスコープ（データ隔離）。
 */
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { loadRangeContext, type RangeContext } from '@/server/repositories/booking-repository';
import { resolveOpenIntervalsForDate } from '@/domain/booking/business-hours';
import { resolveStaffWorkingIntervals } from '@/domain/booking/schedules';
import type { DayStatus } from '@/domain/booking/types';
import { jpHolidayName } from '@/lib/jp-holidays';
import {
  zonedDateMinutesToUtc,
  todayInZone,
  nowUtc,
  zonedDateString,
  isoDateAddDays,
  isoDateDayOfWeek,
  utcToZonedDateMinutes,
  MINUTES_PER_DAY,
} from '@/lib/time';

/**
 * 開業（公開）準備チェック。予約を受け付けられる状態か、何が不足しているかを返す。
 * 「設定したのに予約できない/公開しても×」というオンボーディングの落とし穴を可視化する。
 */
export interface PublishReadiness {
  ready: boolean;
  publicPath: string; // /book/{slug}
  checks: {
    businessHours: boolean;
    menu: boolean;
    staff: boolean;
    shifts: boolean;
    menuStaff: boolean;
    published: boolean;
    onlineBooking: boolean;
  };
  staffWithoutShift: string[];
  menusWithoutStaff: string[];
}

export async function getPublishReadiness(
  tenantId: string,
  shop: { id: string; slug: string; status: string; publicBookingEnabled: boolean },
): Promise<PublishReadiness> {
  const [bhCount, services, staff] = await Promise.all([
    prisma.businessHours.count({ where: { shopId: shop.id } }),
    prisma.service.findMany({
      where: { tenantId, shopId: shop.id, isActive: true, deletedAt: null },
      select: {
        name: true,
        requiresStaff: true,
        serviceStaff: {
          where: { staff: { status: 'ACTIVE', isBookable: true, deletedAt: null } },
          select: { staffId: true },
        },
      },
    }),
    prisma.staff.findMany({
      where: { tenantId, shopId: shop.id, status: 'ACTIVE', isBookable: true, deletedAt: null },
      select: { id: true, name: true, displayName: true },
    }),
  ]);

  // 各稼働スタッフのシフト有無
  const staffIds = staff.map((s) => s.id);
  const scheduled =
    staffIds.length > 0
      ? await prisma.staffSchedule.groupBy({
          by: ['staffId'],
          where: { staffId: { in: staffIds }, isWorking: true },
        })
      : [];
  const withShift = new Set(scheduled.map((r) => r.staffId));
  const staffWithoutShift = staff.filter((s) => !withShift.has(s.id)).map((s) => s.displayName ?? s.name);

  // 担当必須なのにスタッフ未割当のメニュー
  const menusWithoutStaff = services
    .filter((sv) => sv.requiresStaff && sv.serviceStaff.length === 0)
    .map((sv) => sv.name);

  const checks = {
    businessHours: bhCount > 0,
    menu: services.length > 0,
    staff: staff.length > 0,
    shifts: staff.length > 0 && staffWithoutShift.length === 0,
    menuStaff: services.length > 0 && menusWithoutStaff.length === 0,
    published: shop.status === 'PUBLISHED',
    onlineBooking: shop.publicBookingEnabled,
  };

  return {
    ready: Object.values(checks).every(Boolean),
    publicPath: `/book/${shop.slug}`,
    checks,
    staffWithoutShift,
    menusWithoutStaff,
  };
}

/** テナント配下の店舗一覧。 */
export async function getTenantShops(tenantId: string) {
  return prisma.shop.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, name: true, status: true, timezone: true, publicBookingEnabled: true },
  });
}

/** 現在選択中の店舗を識別する Cookie 名。 */
export const SELECTED_SHOP_COOKIE = 'selected_shop';

/**
 * 現在対象の店舗を返す。選択 Cookie が有効（当テナントの店舗）ならそれ、無ければ最初の店舗。
 * これ1か所で解決するため、管理画面の全ページが「選択中の店舗」に自動追従する。
 * リクエスト外（テスト/worker）で cookies() が使えない場合は最初の店舗にフォールバック。
 */
export async function getPrimaryShop(tenantId: string) {
  const allShops = await getTenantShops(tenantId);
  if (allShops.length === 0) throw Errors.notFound('店舗が登録されていません。');

  // スタッフ（テナント全体権限なし）は自分のスコープ店舗のみ対象。オーナー/管理者は全店舗。
  // 認証モジュール(next-auth)は動的 import で遅延ロード（テスト/worker で静的依存に含めない）。
  let shops = allShops;
  try {
    const { getSessionUser } = await import('@/server/auth/authorize');
    const user = await getSessionUser();
    if (user && !user.isPlatformAdmin && !user.tenantWide && user.shopScopes.length > 0) {
      const scoped = allShops.filter((s) => user.shopScopes.includes(s.id));
      if (scoped.length > 0) shops = scoped;
    }
  } catch {
    /* リクエストコンテキスト外（worker/test）は全店舗のまま */
  }

  let selectedId: string | undefined;
  try {
    const { cookies } = await import('next/headers');
    selectedId = cookies().get(SELECTED_SHOP_COOKIE)?.value;
  } catch {
    /* リクエストコンテキスト外 */
  }
  return shops.find((s) => s.id === selectedId) ?? shops[0]!;
}

/**
 * 「実現売上」の対象条件（Prisma where フラグメント）。ユーザー方針「実現主義」。
 * - 来店完了(COMPLETED): 常に計上（明示的に来店済み）。
 * - 確定(CONFIRMED): 開始時刻が過ぎたもののみ計上（時間が来た＝実現）。
 * - キャンセル / 無断キャンセル / 仮予約(PENDING): 対象外。
 * これから来る予約は売上に含めない（ダッシュボード等が過大表示になっていた原因の修正）。
 */
function realizedRevenueFilter(now: Date) {
  return {
    OR: [
      { status: 'COMPLETED' as const },
      { status: 'CONFIRMED' as const, startAt: { lt: now } },
    ],
  };
}

export async function getDashboardStats(tenantId: string, shopId: string, timezone: string) {
  const today = todayInZone(timezone);
  const dayStart = zonedDateMinutesToUtc(today, 0, timezone);
  const dayEnd = zonedDateMinutesToUtc(today, 24 * 60, timezone);
  const now = nowUtc();

  const [todayCount, upcomingCount, customerCount, staffCount, serviceCount, todayRevenue] =
    await Promise.all([
      prisma.booking.count({
        where: { tenantId, shopId, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { gte: dayStart, lt: dayEnd } },
      }),
      prisma.booking.count({
        where: { tenantId, shopId, status: 'CONFIRMED', startAt: { gte: now } },
      }),
      prisma.customer.count({ where: { tenantId, deletedAt: null } }),
      prisma.staff.count({ where: { tenantId, shopId, status: 'ACTIVE', deletedAt: null } }),
      prisma.service.count({ where: { tenantId, shopId, isActive: true, deletedAt: null } }),
      // 本日売上は「実現主義」= 来店完了 + 時間が過ぎた確定予約のみ（これから来る予約は含めない）
      prisma.booking.aggregate({
        where: { tenantId, shopId, startAt: { gte: dayStart, lt: dayEnd }, ...realizedRevenueFilter(now) },
        _sum: { totalPriceJpy: true },
      }),
    ]);

  return {
    todayCount,
    upcomingCount,
    customerCount,
    staffCount,
    serviceCount,
    todayRevenue: todayRevenue._sum.totalPriceJpy ?? 0,
  };
}

/** 直近 days 日の予約数・売上トレンド（店舗ローカル日付で集計）。 */
export async function getBookingTrend(
  tenantId: string,
  shopId: string,
  timezone: string,
  days = 14,
): Promise<{ date: string; label: string; count: number; revenue: number }[]> {
  const today = todayInZone(timezone);
  const startDate = isoDateAddDays(today, -(days - 1));
  const fromUtc = zonedDateMinutesToUtc(startDate, 0, timezone);
  const toUtc = zonedDateMinutesToUtc(today, 24 * 60, timezone);
  const now = nowUtc();

  // 実現主義: 来店完了 + 時間が過ぎた確定予約のみ（これから来る予約は含めない）
  const bookings = await prisma.booking.findMany({
    where: {
      tenantId,
      shopId,
      deletedAt: null,
      startAt: { gte: fromUtc, lt: toUtc },
      ...realizedRevenueFilter(now),
    },
    select: { startAt: true, totalPriceJpy: true },
  });

  const byDate = new Map<string, { count: number; revenue: number }>();
  for (const b of bookings) {
    const d = zonedDateString(b.startAt, timezone);
    const cur = byDate.get(d) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += b.totalPriceJpy;
    byDate.set(d, cur);
  }

  const out: { date: string; label: string; count: number; revenue: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = isoDateAddDays(startDate, i);
    const v = byDate.get(d) ?? { count: 0, revenue: 0 };
    const [, m, day] = d.split('-');
    out.push({ date: d, label: `${Number(m)}/${Number(day)}`, count: v.count, revenue: v.revenue });
  }
  return out;
}

/** ステータス別の予約件数（過去90日）。 */
export async function getStatusBreakdown(tenantId: string, shopId: string) {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const grouped = await prisma.booking.groupBy({
    by: ['status'],
    where: { tenantId, shopId, deletedAt: null, startAt: { gte: since } },
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const g of grouped) map[g.status] = g._count._all;
  return map;
}

// ---- 売上・実績レポート（月次）----
export interface MonthlyReport {
  month: string; // YYYY-MM
  prevMonth: string;
  nextMonth: string;
  hasNext: boolean;
  totalRevenue: number;
  bookingCount: number;
  avgSpend: number;
  nominationCount: number;
  nominationRate: number; // 0..1
  newCustomers: number;
  repeatCustomers: number;
  repeatRate: number; // 0..1
  daily: { date: string; label: string; revenue: number; count: number }[];
  byStaff: { name: string; count: number; revenue: number; nomination: number }[];
  byMenu: { name: string; count: number; revenue: number }[];
}

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextY = m === 12 ? y! + 1 : y!;
  const nextM = m === 12 ? 1 : m! + 1;
  const prevY = m === 1 ? y! - 1 : y!;
  const prevM = m === 1 ? 12 : m! - 1;
  return {
    start: `${month}-01`,
    nextMonthStart: `${nextY}-${pad(nextM)}-01`,
    prevMonth: `${prevY}-${pad(prevM)}`,
    nextMonth: `${nextY}-${pad(nextM)}`,
    daysInMonth: new Date(Date.UTC(y!, m!, 0)).getUTCDate(),
  };
}

/** 月次の売上・実績レポート。month は "YYYY-MM"（店舗ローカル暦）。now はテスト用に注入可能。 */
export async function getMonthlyReport(
  tenantId: string,
  shopId: string,
  timezone: string,
  month: string,
  now: Date = nowUtc(),
): Promise<MonthlyReport> {
  const { start, nextMonthStart, prevMonth, nextMonth, daysInMonth } = monthBounds(month);
  const fromUtc = zonedDateMinutesToUtc(start, 0, timezone);
  const toUtc = zonedDateMinutesToUtc(nextMonthStart, 0, timezone);
  const currentMonth = todayInZone(timezone).slice(0, 7);

  // 売上・実績は「実現主義」= 来店完了 + 時間が過ぎた確定予約（当月でも将来の確定予約は含めない）
  const bookings = await prisma.booking.findMany({
    where: { tenantId, shopId, deletedAt: null, startAt: { gte: fromUtc, lt: toUtc }, ...realizedRevenueFilter(now) },
    select: {
      startAt: true,
      totalPriceJpy: true,
      nominationFeeJpy: true,
      customerId: true,
      staffId: true,
      staff: { select: { name: true, displayName: true } },
    },
  });

  const totalRevenue = bookings.reduce((a, b) => a + b.totalPriceJpy, 0);
  const bookingCount = bookings.length;
  const nominationCount = bookings.filter((b) => b.nominationFeeJpy > 0).length;

  // 日別
  const byDate = new Map<string, { count: number; revenue: number }>();
  const staffMap = new Map<string, { name: string; count: number; revenue: number; nomination: number }>();
  for (const b of bookings) {
    const d = zonedDateString(b.startAt, timezone);
    const cur = byDate.get(d) ?? { count: 0, revenue: 0 };
    cur.count += 1;
    cur.revenue += b.totalPriceJpy;
    byDate.set(d, cur);

    const key = b.staffId ?? '__none__';
    const s = staffMap.get(key) ?? {
      name: b.staff?.displayName ?? b.staff?.name ?? 'おまかせ / 未指定',
      count: 0,
      revenue: 0,
      nomination: 0,
    };
    s.count += 1;
    s.revenue += b.totalPriceJpy;
    if (b.nominationFeeJpy > 0) s.nomination += 1;
    staffMap.set(key, s);
  }
  const daily = Array.from({ length: daysInMonth }, (_, i) => {
    const d = isoDateAddDays(start, i);
    const v = byDate.get(d) ?? { count: 0, revenue: 0 };
    return { date: d, label: String(Number(d.split('-')[2])), revenue: v.revenue, count: v.count };
  });
  const byStaff = [...staffMap.values()].sort((a, b) => b.revenue - a.revenue);

  // メニュー別（BookingItem の価格スナップショットで集計。コンボも正確）
  // 注意: 分割施術（segments）は 1 予約×1 メニューでも複数の BookingItem 行になる（価格は先頭行のみ）。
  //       「件数」は予約×メニューのユニーク数で数える（行数だと分割メニューが水増しされる）。売上は全行合算（先頭行のみ価格）。
  const items = await prisma.bookingItem.findMany({
    where: {
      tenantId,
      shopId,
      startAt: { gte: fromUtc, lt: toUtc },
      booking: { deletedAt: null, ...realizedRevenueFilter(now) },
    },
    select: { priceJpy: true, bookingId: true, serviceId: true, service: { select: { name: true } } },
  });
  const menuMap = new Map<string, { name: string; count: number; revenue: number; seen: Set<string> }>();
  for (const it of items) {
    const cur = menuMap.get(it.service.name) ?? { name: it.service.name, count: 0, revenue: 0, seen: new Set<string>() };
    const key = `${it.bookingId}:${it.serviceId}`;
    if (!cur.seen.has(key)) {
      cur.seen.add(key);
      cur.count += 1;
    }
    cur.revenue += it.priceJpy;
    menuMap.set(it.service.name, cur);
  }
  const byMenu = [...menuMap.values()]
    .map(({ name, count, revenue }) => ({ name, count, revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  // 新規 vs リピート（当月に来店した顧客のうち、当月より前に来店実績があるか）
  const customerIds = [...new Set(bookings.map((b) => b.customerId).filter((x): x is string => !!x))];
  let newCustomers = 0;
  let repeatCustomers = 0;
  if (customerIds.length > 0) {
    const prior = await prisma.booking.findMany({
      where: { tenantId, shopId, customerId: { in: customerIds }, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { lt: fromUtc } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const returning = new Set(prior.map((p) => p.customerId));
    for (const cid of customerIds) (returning.has(cid) ? repeatCustomers++ : newCustomers++);
  }
  const distinctCustomers = newCustomers + repeatCustomers;

  return {
    month,
    prevMonth,
    nextMonth,
    hasNext: nextMonth <= currentMonth,
    totalRevenue,
    bookingCount,
    avgSpend: bookingCount ? Math.round(totalRevenue / bookingCount) : 0,
    nominationCount,
    nominationRate: bookingCount ? nominationCount / bookingCount : 0,
    newCustomers,
    repeatCustomers,
    repeatRate: distinctCustomers ? repeatCustomers / distinctCustomers : 0,
    daily,
    byStaff,
    byMenu,
  };
}

// ---- 休眠顧客（再来促進）----
export interface DormantCustomer {
  id: string;
  name: string;
  nameKana: string | null;
  email: string | null;
  phone: string | null;
  lastVisit: Date;
  visitCount: number;
  totalSpent: number;
}

/**
 * 最終来店から days 日以上が経過し、今後の予約が無い顧客（=休眠）。最終来店が新しい順。
 */
export async function getDormantCustomers(
  tenantId: string,
  shopId: string,
  days: number,
): Promise<DormantCustomer[]> {
  const now = nowUtc();
  const threshold = new Date(now.getTime() - days * 86_400_000);

  const grouped = await prisma.booking.groupBy({
    by: ['customerId'],
    where: { tenantId, shopId, deletedAt: null, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { lt: now } },
    _max: { startAt: true },
    _count: { _all: true },
    _sum: { totalPriceJpy: true },
  });

  const dormant = grouped.filter((g) => g.customerId && g._max.startAt && g._max.startAt < threshold);
  if (dormant.length === 0) return [];
  const ids = dormant.map((g) => g.customerId!) as string[];

  // 今後の予約（CONFIRMED, 未来）がある顧客は「戻ってくる」ので除外
  const upcoming = await prisma.booking.findMany({
    where: { tenantId, shopId, status: 'CONFIRMED', startAt: { gte: now }, customerId: { in: ids } },
    select: { customerId: true },
    distinct: ['customerId'],
  });
  const hasUpcoming = new Set(upcoming.map((u) => u.customerId));

  const customers = await prisma.customer.findMany({
    where: { id: { in: ids }, tenantId, deletedAt: null },
    select: { id: true, name: true, nameKana: true, email: true, phone: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  return dormant
    .filter((g) => !hasUpcoming.has(g.customerId) && byId.has(g.customerId!))
    .map((g) => {
      const c = byId.get(g.customerId!)!;
      return {
        id: c.id,
        name: c.name,
        nameKana: c.nameKana,
        email: c.email,
        phone: c.phone,
        lastVisit: g._max.startAt!,
        visitCount: g._count._all,
        totalSpent: g._sum.totalPriceJpy ?? 0,
      };
    })
    .sort((a, b) => b.lastVisit.getTime() - a.lastVisit.getTime());
}

/** 指定月の予約をCSVエクスポート用に取得（全ステータス）。 */
export async function getBookingsForExport(tenantId: string, shopId: string, timezone: string, month: string) {
  const { start, nextMonthStart } = monthBounds(month);
  const fromUtc = zonedDateMinutesToUtc(start, 0, timezone);
  const toUtc = zonedDateMinutesToUtc(nextMonthStart, 0, timezone);
  return prisma.booking.findMany({
    where: { tenantId, shopId, deletedAt: null, startAt: { gte: fromUtc, lt: toUtc } },
    orderBy: { startAt: 'asc' },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      customerName: true,
      customerEmail: true,
      customerPhone: true,
      partySize: true,
      totalPriceJpy: true,
      nominationFeeJpy: true,
      service: { select: { name: true } },
      staff: { select: { name: true, displayName: true } },
      items: { orderBy: { sortOrder: 'asc' }, select: { service: { select: { name: true } } } },
    },
  });
}

// ---- スケジュールボード（日/週 × スタッフ絞り込み）----
//
// 予約だけを描いていた頃は「今日この人は何時から出勤なのか」が画面から分からず、
// 店主は代理予約のたびにシフト設定ページを別途開いて確認するしかなかった。
// ここでは営業時間・臨時休業・祝日休業・スタッフのシフト（曜日＋個別の上書き）を
// 予約エンジンと**同じ純関数**で合成し、「実際に働く時間」を返す。
// 別ロジックで再実装すると、画面の表示と実際の予約可否がずれて誰も信じられなくなる。

export interface ScheduleBlock {
  id: string;
  customerName: string;
  serviceName: string;
  startMin: number; // 店舗ローカル 0:00 からの分
  endMin: number;
  status: string;
}

/** 勤務区間（店舗ローカル 0:00 からの分）。営業時間との重なりだけを残した実働。 */
export interface ShiftSpan {
  startMin: number;
  endMin: number;
}

export interface ScheduleStaffOption {
  id: string;
  name: string;
}

export interface DayScheduleLane {
  key: string; // staffId、担当なしは '__none__'
  name: string;
  shifts: ShiftSpan[];
  bookings: ScheduleBlock[];
  /** 退職・停止済みスタッフのレーン。予約だけが残っている状態。 */
  inactive?: boolean;
}

export interface DaySchedule {
  date: string;
  timezone: string;
  openMin: number;
  closeMin: number;
  isClosed: boolean;
  /** 休業の理由（定休日/祝日/臨時休業）。空欄のまま放置すると原因が分からない。 */
  closedLabel: string | null;
  /** 祝日名（あれば）。休業でなくても表示する。 */
  holidayName: string | null;
  prevDate: string;
  nextDate: string;
  today: string;
  lanes: DayScheduleLane[];
  staffOptions: ScheduleStaffOption[];
  /** 実際に適用された絞り込み（未知のIDは null に丸められる）。画面の選択状態はこれに従う。 */
  selectedStaffId: string | null;
}

export interface WeekDayCell {
  date: string;
  shifts: ShiftSpan[];
  bookingCount: number;
}

export interface WeekScheduleColumn {
  date: string;
  month: number;
  day: number;
  dow: number;
  isClosed: boolean;
  closedLabel: string | null;
  holidayName: string | null;
  isToday: boolean;
}

export interface WeekSchedule {
  from: string;
  to: string;
  timezone: string;
  prevDate: string;
  nextDate: string;
  today: string;
  columns: WeekScheduleColumn[];
  rows: { staffId: string; name: string; days: WeekDayCell[]; inactive?: boolean }[];
  staffOptions: ScheduleStaffOption[];
  /** 実際に適用された絞り込み（未知のIDは null に丸められる）。画面の選択状態はこれに従う。 */
  selectedStaffId: string | null;
}

const DAY_STATUS_LABEL: Record<string, string> = {
  REGULAR_CLOSED: '定休日',
  HOLIDAY_CLOSED: '祝日休業',
  TEMP_CLOSED: '臨時休業',
};

/**
 * 稼働スタッフ（並び順つき）。staffId を渡すとその1名に絞る。
 *
 * 知らない staffId（他店舗のID・退職者・URL の打ち間違い）が来たら**絞り込みを無かったことにする**。
 * そのまま空で返すと「スタッフがいません」とだけ出て、絞り込みチップは『全員』が選択された状態になり、
 * 店主から見ると理由の分からない空の表になる。
 */
async function loadBoardStaff(tenantId: string, shopId: string, staffId?: string | null) {
  const all = await prisma.staff.findMany({
    where: { tenantId, shopId, status: 'ACTIVE', deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, displayName: true },
  });
  const options: ScheduleStaffOption[] = all.map((s) => ({ id: s.id, name: s.displayName ?? s.name }));
  const resolved = staffId && all.some((s) => s.id === staffId) ? staffId : null;
  const selected = resolved ? all.filter((s) => s.id === resolved) : all;
  return { options, selected, selectedStaffId: resolved };
}

/**
 * 予約が参照しているのに稼働スタッフ一覧に居ないスタッフを解決する。
 *
 * 退職処理（softDeleteStaff）は既存予約を取り消しも付け替えもしない。
 * そのため「担当者が退職済みの予約」が普通に残るが、レーンを稼働スタッフだけで作ると
 * その予約は**どのレーンにも入らず画面から消える**——タイムラインの幅だけは広がるので、
 * 店主には「空欄が伸びている」としか見えない。客は当日ふつうに来店する。
 * ここで名前を引き当て、退職者のレーンとして必ず描く。
 */
async function loadInactiveStaffFor(
  tenantId: string,
  shopId: string,
  ids: string[],
): Promise<{ id: string; name: string }[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.staff.findMany({
    where: { tenantId, shopId, id: { in: ids } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, displayName: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.displayName ?? r.name }));
}

/**
 * 1日分の「店舗の営業区間」と「スタッフ別の実働区間」を分で返す。
 * 実働 = シフト ∩ 営業区間。休業日にシフトだけ残っていても働けないため、
 * そのまま出すと画面が嘘をつく（客の予約画面には出ないのに、店主の画面では出勤に見える）。
 */
function resolveDayShifts(params: {
  date: string;
  timezone: string;
  staffIds: string[];
  ctx: RangeContext;
  closeOnNationalHolidays: boolean;
}): { dayStatus: DayStatus; openSpans: ShiftSpan[]; shiftsByStaff: Map<string, ShiftSpan[]> } {
  const { date, timezone, staffIds, ctx, closeOnNationalHolidays } = params;
  const dayStartMs = zonedDateMinutesToUtc(date, 0, timezone).getTime();
  const toMin = (d: Date) => Math.round((d.getTime() - dayStartMs) / 60_000);

  const resolved = resolveOpenIntervalsForDate({
    date,
    timeZone: timezone,
    businessHours: ctx.businessHours,
    specialDay: ctx.specialDaysByDate.get(date) ?? null,
    isNationalHoliday: ctx.holidayDates.has(date),
    closeOnNationalHolidays,
  });
  const openSpans = resolved.openIntervals.map((i) => ({ startMin: toMin(i.start), endMin: toMin(i.end) }));

  const shiftsByStaff = new Map<string, ShiftSpan[]>();
  if (openSpans.length > 0 && staffIds.length > 0) {
    const working = resolveStaffWorkingIntervals({
      date,
      timeZone: timezone,
      staffIds,
      schedules: [...ctx.recurringSchedules, ...(ctx.overridesByDate.get(date) ?? [])],
    });
    for (const w of working) {
      const s = toMin(w.start);
      const e = toMin(w.end);
      for (const o of openSpans) {
        const start = Math.max(s, o.startMin);
        const end = Math.min(e, o.endMin);
        if (end > start) {
          const arr = shiftsByStaff.get(w.staffId) ?? [];
          arr.push({ startMin: start, endMin: end });
          shiftsByStaff.set(w.staffId, arr);
        }
      }
    }
    for (const arr of shiftsByStaff.values()) arr.sort((a, b) => a.startMin - b.startMin);
  }

  return { dayStatus: resolved.dayStatus, openSpans, shiftsByStaff };
}

/** 指定日のスタッフ別タイムライン。前台が一日を一目で把握するためのボード。 */
export async function getDaySchedule(
  tenantId: string,
  shopId: string,
  timezone: string,
  date: string,
  staffId?: string | null,
): Promise<DaySchedule> {
  const dayStart = zonedDateMinutesToUtc(date, 0, timezone);
  const dayEnd = zonedDateMinutesToUtc(date, MINUTES_PER_DAY, timezone);
  const nextDate = isoDateAddDays(date, 1);

  const { options, selected, selectedStaffId } = await loadBoardStaff(tenantId, shopId, staffId);
  const staffIds = selected.map((s) => s.id);

  const [shop, ctx, bookings] = await Promise.all([
    prisma.shop.findFirst({ where: { id: shopId, tenantId }, select: { closeOnNationalHolidays: true } }),
    loadRangeContext(
      prisma,
      shopId,
      new Date(`${date}T00:00:00.000Z`),
      new Date(`${nextDate}T00:00:00.000Z`),
      staffIds,
    ),
    prisma.booking.findMany({
      where: {
        tenantId,
        shopId,
        deletedAt: null,
        status: { in: ['CONFIRMED', 'COMPLETED', 'PENDING'] },
        startAt: { gte: dayStart, lt: dayEnd },
        ...(selectedStaffId ? { staffId: selectedStaffId } : {}),
      },
      orderBy: { startAt: 'asc' },
      select: { id: true, staffId: true, startAt: true, endAt: true, customerName: true, status: true, service: { select: { name: true } } },
    }),
  ]);

  const { dayStatus, openSpans, shiftsByStaff } = resolveDayShifts({
    date,
    timezone,
    staffIds,
    ctx,
    closeOnNationalHolidays: shop?.closeOnNationalHolidays ?? true,
  });

  const enriched = bookings.map((b) => {
    const startMin = utcToZonedDateMinutes(b.startAt, timezone).minutes;
    const durMin = Math.max(15, Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000));
    return {
      staffId: b.staffId,
      block: { id: b.id, customerName: b.customerName, serviceName: b.service.name, startMin, endMin: startMin + durMin, status: b.status },
    };
  });

  // タイムライン範囲: 営業時間 + シフト + 予約を内包し、時単位に丸める
  let openMin = Number.POSITIVE_INFINITY;
  let closeMin = Number.NEGATIVE_INFINITY;
  for (const o of openSpans) {
    openMin = Math.min(openMin, o.startMin);
    closeMin = Math.max(closeMin, o.endMin);
  }
  for (const arr of shiftsByStaff.values()) {
    for (const sh of arr) {
      openMin = Math.min(openMin, sh.startMin);
      closeMin = Math.max(closeMin, sh.endMin);
    }
  }
  for (const e of enriched) {
    openMin = Math.min(openMin, e.block.startMin);
    closeMin = Math.max(closeMin, e.block.endMin);
  }
  const isClosed = openSpans.length === 0 && enriched.length === 0;
  if (!Number.isFinite(openMin) || !Number.isFinite(closeMin)) {
    openMin = 600;
    closeMin = 1140;
  }
  openMin = Math.floor(openMin / 60) * 60;
  closeMin = Math.ceil(closeMin / 60) * 60;
  if (closeMin <= openMin) closeMin = openMin + 60;

  const lanes: DayScheduleLane[] = selected.map((s) => ({
    key: s.id,
    name: s.displayName ?? s.name,
    shifts: shiftsByStaff.get(s.id) ?? [],
    bookings: enriched.filter((e) => e.staffId === s.id).map((e) => e.block),
  }));

  // 退職・停止済みスタッフの予約を拾う（稼働一覧に居ないので上のループでは漏れる）
  const activeIds = new Set(staffIds);
  const orphanIds = [...new Set(enriched.map((e) => e.staffId).filter((id): id is string => !!id && !activeIds.has(id)))];
  for (const st of await loadInactiveStaffFor(tenantId, shopId, orphanIds)) {
    lanes.push({
      key: st.id,
      name: st.name,
      shifts: [],
      bookings: enriched.filter((e) => e.staffId === st.id).map((e) => e.block),
      inactive: true,
    });
  }

  const unassigned = enriched.filter((e) => !e.staffId).map((e) => e.block);
  if (unassigned.length > 0) lanes.push({ key: '__none__', name: '未割当', shifts: [], bookings: unassigned });

  const holiday = jpHolidayName(date);

  return {
    date,
    timezone,
    openMin,
    closeMin,
    isClosed,
    closedLabel: openSpans.length === 0 ? (DAY_STATUS_LABEL[dayStatus] ?? '休業') : null,
    holidayName: holiday,
    prevDate: isoDateAddDays(date, -1),
    nextDate,
    today: todayInZone(timezone),
    lanes,
    staffOptions: options,
    selectedStaffId,
  };
}

/** 週の起点（月曜）へ丸める。日本のシフト表は月曜始まりが一般的。 */
function weekStart(date: string): string {
  const dow = isoDateDayOfWeek(date); // 0=日
  return isoDateAddDays(date, dow === 0 ? -6 : 1 - dow);
}

/**
 * 週間シフト表（縦: スタッフ / 横: 7日）。
 * 店主が紙で作っている表をそのまま置き換えるための形。
 */
export async function getWeekSchedule(
  tenantId: string,
  shopId: string,
  timezone: string,
  date: string,
  staffId?: string | null,
): Promise<WeekSchedule> {
  const from = weekStart(date);
  const dates = Array.from({ length: 7 }, (_, i) => isoDateAddDays(from, i));
  const endExclusive = isoDateAddDays(from, 7);

  const { options, selected, selectedStaffId } = await loadBoardStaff(tenantId, shopId, staffId);
  const staffIds = selected.map((s) => s.id);

  const [shop, ctx, bookings] = await Promise.all([
    prisma.shop.findFirst({ where: { id: shopId, tenantId }, select: { closeOnNationalHolidays: true } }),
    loadRangeContext(
      prisma,
      shopId,
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${endExclusive}T00:00:00.000Z`),
      staffIds,
    ),
    prisma.booking.findMany({
      where: {
        tenantId,
        shopId,
        deletedAt: null,
        status: { in: ['CONFIRMED', 'COMPLETED', 'PENDING'] },
        startAt: {
          gte: zonedDateMinutesToUtc(from, 0, timezone),
          lt: zonedDateMinutesToUtc(endExclusive, 0, timezone),
        },
        ...(selectedStaffId ? { staffId: selectedStaffId } : {}),
      },
      select: { staffId: true, startAt: true },
    }),
  ]);

  const closeOnNationalHolidays = shop?.closeOnNationalHolidays ?? true;

  // 予約件数を (staffId, 暦日) で集計
  const counts = new Map<string, number>();
  for (const b of bookings) {
    if (!b.staffId) continue;
    const d = zonedDateString(b.startAt, timezone);
    const k = `${b.staffId}|${d}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const perDate = dates.map((d) => ({
    date: d,
    ...resolveDayShifts({ date: d, timezone, staffIds, ctx, closeOnNationalHolidays }),
  }));

  const today = todayInZone(timezone);
  const columns: WeekScheduleColumn[] = perDate.map((pd) => {
    const [y, m, dd] = pd.date.split('-').map(Number);
    return {
      date: pd.date,
      month: m!,
      day: dd!,
      dow: isoDateDayOfWeek(pd.date),
      isClosed: pd.openSpans.length === 0,
      closedLabel: pd.openSpans.length === 0 ? (DAY_STATUS_LABEL[pd.dayStatus] ?? '休業') : null,
      holidayName: jpHolidayName(pd.date),
      isToday: pd.date === today,
    };
  });

  const rows: WeekSchedule['rows'] = selected.map((s) => ({
    staffId: s.id,
    name: s.displayName ?? s.name,
    days: perDate.map((pd) => ({
      date: pd.date,
      shifts: pd.shiftsByStaff.get(s.id) ?? [],
      bookingCount: counts.get(`${s.id}|${pd.date}`) ?? 0,
    })),
  }));

  // 退職・停止済みスタッフに予約が残っていれば行として出す（黙って0件にしない）
  const activeIds = new Set(staffIds);
  const orphanIds = [...new Set(bookings.map((b) => b.staffId).filter((id): id is string => !!id && !activeIds.has(id)))];
  for (const st of await loadInactiveStaffFor(tenantId, shopId, orphanIds)) {
    rows.push({
      staffId: st.id,
      name: st.name,
      inactive: true,
      days: perDate.map((pd) => ({
        date: pd.date,
        shifts: [],
        bookingCount: counts.get(`${st.id}|${pd.date}`) ?? 0,
      })),
    });
  }

  return {
    from,
    to: dates[6]!,
    timezone,
    prevDate: isoDateAddDays(from, -7),
    nextDate: isoDateAddDays(from, 7),
    today,
    columns,
    rows,
    staffOptions: options,
    selectedStaffId,
  };
}

/** ログイン中ユーザーに紐づくスタッフ ID（当該店舗）。スタッフでなければ null。 */
export async function getStaffIdForUser(tenantId: string, userId: string, shopId: string): Promise<string | null> {
  const staff = await prisma.staff.findFirst({
    where: { tenantId, shopId, userId, deletedAt: null },
    select: { id: true },
  });
  return staff?.id ?? null;
}

export interface BookingListFilter {
  status?: string;
  from?: Date;
  to?: Date;
  take?: number;
  /** 並び順（既定 desc=新しい順。ダッシュボードの「直近の予約」は asc=近い順） */
  order?: 'asc' | 'desc';
}

const VALID_BOOKING_STATUSES = new Set(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

/** 予約一覧。status はクエリ文字列由来のため検証し、不正値は無視（500 にしない）。 */
export async function listBookings(tenantId: string, shopId: string, filter: BookingListFilter = {}) {
  const status = filter.status && VALID_BOOKING_STATUSES.has(filter.status) ? filter.status : undefined;
  return prisma.booking.findMany({
    where: {
      tenantId,
      shopId,
      deletedAt: null,
      ...(status ? { status: status as never } : {}),
      ...(filter.from || filter.to
        ? { startAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
        : {}),
    },
    orderBy: { startAt: filter.order ?? 'desc' },
    take: filter.take ?? 100,
    select: {
      id: true,
      status: true,
      startAt: true,
      endAt: true,
      customerName: true,
      customerPhone: true,
      totalPriceJpy: true,
      cancellationToken: true,
      service: { select: { name: true } },
      staff: { select: { name: true, displayName: true } },
    },
  });
}

export async function listCustomers(tenantId: string, take = 100) {
  return prisma.customer.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      name: true,
      nameKana: true,
      email: true,
      phone: true,
      createdAt: true,
      _count: { select: { bookings: true } },
    },
  });
}

export async function listStaff(tenantId: string, shopId: string) {
  return prisma.staff.findMany({
    where: { tenantId, shopId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      displayName: true,
      email: true,
      phone: true,
      isBookable: true,
      capacity: true,
      status: true,
      _count: { select: { serviceStaff: true } },
    },
  });
}

export async function listServices(tenantId: string, shopId: string) {
  return prisma.service.findMany({
    where: { tenantId, shopId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      name: true,
      category: true,
      durationMin: true,
      priceJpy: true,
      salePriceJpy: true,
      capacity: true,
      requiresStaff: true,
      slotIntervalMin: true,
      bufferAfterMin: true,
      isActive: true,
      color: true,
      _count: { select: { serviceStaff: true } },
    },
  });
}

/** フォーム用: メニュー選択肢。 */
export async function getServiceOptions(tenantId: string, shopId: string) {
  return prisma.service.findMany({
    where: { tenantId, shopId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });
}

/** フォーム用: スタッフ選択肢。 */
export async function getStaffOptions(tenantId: string, shopId: string) {
  return prisma.staff.findMany({
    where: { tenantId, shopId, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });
}

/** 編集用: スタッフ + 担当サービスID。 */
export async function getStaffForEdit(tenantId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId, deletedAt: null },
    select: {
      id: true, shopId: true, name: true, displayName: true, email: true, phone: true, bio: true,
      isBookable: true, capacity: true, nominationFeeJpy: true, status: true, sortOrder: true,
      serviceStaff: { select: { serviceId: true } },
      user: { select: { email: true, status: true } },
    },
  });
  if (!staff) throw Errors.notFound('スタッフが見つかりません。');
  const { user, serviceStaff, ...rest } = staff;
  return {
    ...rest,
    serviceIds: serviceStaff.map((s) => s.serviceId),
    login: user ? { email: user.email, active: user.status === 'ACTIVE' } : null,
  };
}

/** 編集用: サービス + 担当スタッフID + segments。 */
export async function getServiceForEdit(tenantId: string, serviceId: string) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, tenantId, deletedAt: null },
    select: {
      id: true, shopId: true, name: true, category: true, description: true, durationMin: true, segments: true,
      bufferAfterMin: true, priceJpy: true, salePriceJpy: true, capacity: true, requiresStaff: true, slotIntervalMin: true,
      color: true, isActive: true, sortOrder: true,
      serviceStaff: { select: { staffId: true } },
      options: {
        where: { deletedAt: null },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, priceJpy: true, extraDurationMin: true },
      },
    },
  });
  if (!service) throw Errors.notFound('メニューが見つかりません。');
  return { ...service, staffIds: service.serviceStaff.map((s) => s.staffId) };
}

/** スタッフのシフト（曜日シフト + 特定日上書き）。 */
export async function getStaffSchedule(tenantId: string, staffId: string) {
  const staff = await prisma.staff.findFirst({
    where: { id: staffId, tenantId, deletedAt: null },
    select: { id: true, shopId: true, name: true, displayName: true },
  });
  if (!staff) throw Errors.notFound('スタッフが見つかりません。');
  const schedules = await prisma.staffSchedule.findMany({
    where: { staffId },
    orderBy: [{ type: 'asc' }, { dayOfWeek: 'asc' }, { date: 'asc' }],
  });
  return {
    staff,
    recurring: schedules
      .filter((s) => s.type === 'RECURRING' && s.startMinute != null && s.endMinute != null)
      .map((s) => ({ dayOfWeek: s.dayOfWeek!, startMinute: s.startMinute!, endMinute: s.endMinute! })),
    overrides: schedules.filter((s) => s.type === 'OVERRIDE'),
  };
}

/** テナントの操作ログ（監査ログ, tenantId スコープ）。 */
export async function listTenantAuditLogs(tenantId: string, take = 100) {
  return prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      resourceType: true,
      resourceId: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
  });
}

/** 顧客詳細 + 予約履歴。 */
export async function getCustomerDetail(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, deletedAt: null },
    select: { id: true, name: true, nameKana: true, email: true, phone: true, note: true, createdAt: true },
  });
  if (!customer) throw Errors.notFound('顧客が見つかりません。');

  // カルテ統計は「全予約」を対象に集計する（表示リストの take:50 に依存しない）。
  // where は各クエリにインラインで書く（Prisma の文脈型で enum を推論させるため）。
  const now = nowUtc();

  const [bookings, agg, firstVisit, lastVisit, nextBooking] = await Promise.all([
    // 表示用の履歴（直近50件）
    prisma.booking.findMany({
      where: { tenantId, customerId, deletedAt: null },
      orderBy: { startAt: 'desc' },
      take: 50,
      select: {
        id: true, status: true, startAt: true, totalPriceJpy: true,
        service: { select: { name: true } },
        staff: { select: { name: true, displayName: true } },
        shop: { select: { timezone: true } },
      },
    }),
    prisma.booking.aggregate({
      where: { tenantId, customerId, deletedAt: null, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { lt: now } },
      _count: { _all: true },
      _sum: { totalPriceJpy: true },
    }),
    prisma.booking.findFirst({
      where: { tenantId, customerId, deletedAt: null, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { lt: now } },
      orderBy: { startAt: 'asc' },
      select: { startAt: true },
    }),
    prisma.booking.findFirst({
      where: { tenantId, customerId, deletedAt: null, status: { in: ['CONFIRMED', 'COMPLETED'] }, startAt: { lt: now } },
      orderBy: { startAt: 'desc' },
      select: { startAt: true },
    }),
    prisma.booking.findFirst({
      where: { tenantId, customerId, deletedAt: null, status: 'CONFIRMED', startAt: { gte: now } },
      orderBy: { startAt: 'asc' },
      select: { startAt: true },
    }),
  ]);

  const stats = {
    visitCount: agg._count._all,
    totalSpent: agg._sum.totalPriceJpy ?? 0,
    firstVisit: firstVisit?.startAt ?? null,
    lastVisit: lastVisit?.startAt ?? null,
    nextBooking: nextBooking?.startAt ?? null,
  };
  return { customer, bookings, stats };
}

/** 営業時間・休業・容量ルールなど店舗設定の読み取り。 */
export async function getShopConfig(tenantId: string, shopId: string) {
  const [shop, businessHours, specialDays, rules] = await Promise.all([
    prisma.shop.findFirst({
      where: { id: shopId, tenantId },
      select: {
        id: true, slug: true, name: true, description: true, phone: true, email: true,
        postalCode: true, prefecture: true, city: true, address: true, timezone: true,
        status: true, publicBookingEnabled: true, closeOnNationalHolidays: true, settings: true,
      },
    }),
    prisma.businessHours.findMany({ where: { shopId }, orderBy: [{ dayOfWeek: 'asc' }, { openMinute: 'asc' }] }),
    prisma.specialBusinessDay.findMany({ where: { shopId }, orderBy: { date: 'asc' } }),
    prisma.bookingCapacityRule.findMany({ where: { shopId, tenantId }, orderBy: { scope: 'asc' } }),
  ]);
  if (!shop) throw Errors.notFound('店舗が見つかりません。');
  return { shop, businessHours, specialDays, rules };
}
