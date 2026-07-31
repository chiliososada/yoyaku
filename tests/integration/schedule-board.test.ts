/**
 * スケジュールボード（日/週 × スタッフ絞り込み）の統合テスト。
 *
 * ここで守りたいのは「画面が嘘をつかない」こと:
 *  - 表示される勤務時間は、予約エンジンが実際に使う稼働時間と一致する
 *    （シフト ∩ 営業時間。休業日にシフトだけ残っていても出勤には見せない）
 *  - 休みの理由（定休日/祝日休業/臨時休業/個別の欠勤）が区別できる
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { getDaySchedule, getWeekSchedule } from '@/server/services/merchant-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

const TZ = 'Asia/Tokyo';
// 2026-06-15 は月曜。週表示の起点確認に使う。
const MONDAY = '2026-06-15';
const WEDNESDAY = '2026-06-17';
const SUNDAY = '2026-06-21';

const dateObj = (d: string) => new Date(`${d}T00:00:00.000Z`);

async function scenario(opts: Parameters<typeof seedScenario>[0] = {}) {
  const sc = await seedScenario({ staffCount: 2, openMinute: 600, closeMinute: 1140, ...opts });
  createdTenants.push(sc.tenantId);
  return sc;
}

/** 予約を1件作る（Booking は customerId 必須）。 */
async function addBooking(
  sc: { tenantId: string; shopId: string; serviceId: string },
  opts: { date: string; staffId: string | null; name: string },
) {
  const customer = await prisma.customer.create({
    data: { tenantId: sc.tenantId, shopId: sc.shopId, name: opts.name },
  });
  const startAt = new Date(`${opts.date}T01:00:00.000Z`); // JST 10:00
  return prisma.booking.create({
    data: {
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId: customer.id,
      serviceId: sc.serviceId,
      staffId: opts.staffId,
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
      status: 'CONFIRMED',
      customerName: opts.name,
      totalPriceJpy: 5000,
    },
  });
}

describe('週間シフト表', () => {
  it('どの日を指定しても月曜始まりの7日を返す', async () => {
    const sc = await scenario();
    for (const d of [MONDAY, WEDNESDAY, SUNDAY]) {
      const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, d);
      expect(w.from).toBe(MONDAY);
      expect(w.columns).toHaveLength(7);
      expect(w.columns[0]!.date).toBe(MONDAY);
      expect(w.columns[6]!.date).toBe('2026-06-21');
      expect(w.columns[0]!.dow).toBe(1);
      expect(w.columns[6]!.dow).toBe(0);
    }
  });

  it('前週・翌週は7日ずつ動く', async () => {
    const sc = await scenario();
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, WEDNESDAY);
    expect(w.prevDate).toBe('2026-06-08');
    expect(w.nextDate).toBe('2026-06-22');
  });

  it('シフトは営業時間との重なりだけを返す（画面と予約可否がずれない）', async () => {
    // 営業 10:00-19:00 に対し、スタッフは 9:00-20:00 で登録
    const sc = await scenario();
    await prisma.staffSchedule.updateMany({
      where: { staffId: sc.staffIds[0]!, type: 'RECURRING' },
      data: { startMinute: 540, endMinute: 1200 },
    });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const row = w.rows.find((r) => r.staffId === sc.staffIds[0]!)!;
    expect(row.days[0]!.shifts).toEqual([{ startMin: 600, endMin: 1140 }]);
  });

  it('定休日はシフトが空になり、理由が「定休日」になる', async () => {
    const sc = await scenario();
    // 月曜(dow=1)の営業時間を消す
    await prisma.businessHours.deleteMany({ where: { shopId: sc.shopId, dayOfWeek: 1 } });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    expect(w.columns[0]!.isClosed).toBe(true);
    expect(w.columns[0]!.closedLabel).toBe('定休日');
    for (const row of w.rows) expect(row.days[0]!.shifts).toEqual([]);
    // 火曜は通常どおり
    expect(w.columns[1]!.isClosed).toBe(false);
    expect(w.rows[0]!.days[1]!.shifts.length).toBe(1);
  });

  it('臨時休業を登録した日はシフトが消え、理由が「臨時休業」になる', async () => {
    const sc = await scenario();
    await prisma.specialBusinessDay.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, date: dateObj(WEDNESDAY), type: 'CLOSED', reason: '研修' },
    });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const wed = w.columns.findIndex((c) => c.date === WEDNESDAY);
    expect(w.columns[wed]!.closedLabel).toBe('臨時休業');
    for (const row of w.rows) expect(row.days[wed]!.shifts).toEqual([]);
  });

  it('祝日休業ONの店は祝日のシフトが消え、祝日名も返る', async () => {
    // 2026-07-20 は海の日（月曜）
    const sc = await scenario();
    await prisma.shop.update({ where: { id: sc.shopId }, data: { closeOnNationalHolidays: true } });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, '2026-07-20');
    const col = w.columns[0]!;
    expect(col.date).toBe('2026-07-20');
    expect(col.holidayName).toBe('海の日');
    expect(col.closedLabel).toBe('祝日休業');
    for (const row of w.rows) expect(row.days[0]!.shifts).toEqual([]);
  });

  it('祝日休業OFFの店は祝日でも通常どおり出勤（祝日名だけ出る）', async () => {
    const sc = await scenario(); // seed は closeOnNationalHolidays=false
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, '2026-07-20');
    const col = w.columns[0]!;
    expect(col.holidayName).toBe('海の日');
    expect(col.isClosed).toBe(false);
    expect(w.rows[0]!.days[0]!.shifts.length).toBe(1);
  });

  it('個別の欠勤(OVERRIDE)はその人・その日だけ休みになる', async () => {
    const sc = await scenario();
    await prisma.staffSchedule.create({
      data: {
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        staffId: sc.staffIds[0]!,
        type: 'OVERRIDE',
        date: dateObj(WEDNESDAY),
        isWorking: false,
      },
    });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const wed = w.columns.findIndex((c) => c.date === WEDNESDAY);
    const off = w.rows.find((r) => r.staffId === sc.staffIds[0]!)!;
    const on = w.rows.find((r) => r.staffId === sc.staffIds[1]!)!;
    expect(off.days[wed]!.shifts).toEqual([]);
    expect(on.days[wed]!.shifts.length).toBe(1);
    // 店は開いている（休業ではなく本人の欠勤）
    expect(w.columns[wed]!.isClosed).toBe(false);
  });

  it('個別の出勤(OVERRIDE)は曜日シフトを上書きする', async () => {
    const sc = await scenario();
    await prisma.staffSchedule.create({
      data: {
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        staffId: sc.staffIds[0]!,
        type: 'OVERRIDE',
        date: dateObj(WEDNESDAY),
        startMinute: 780, // 13:00
        endMinute: 1080, // 18:00
        isWorking: true,
      },
    });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const wed = w.columns.findIndex((c) => c.date === WEDNESDAY);
    const row = w.rows.find((r) => r.staffId === sc.staffIds[0]!)!;
    expect(row.days[wed]!.shifts).toEqual([{ startMin: 780, endMin: 1080 }]);
  });

  it('スタッフ絞り込みは1行だけ返し、選択肢は全員分を保つ', async () => {
    const sc = await scenario();
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY, sc.staffIds[1]!);
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]!.staffId).toBe(sc.staffIds[1]!);
    expect(w.selectedStaffId).toBe(sc.staffIds[1]!);
    // 絞り込んでも他のスタッフへ切り替えられなければ使い物にならない
    expect(w.staffOptions).toHaveLength(2);
  });

  it('知らないスタッフIDは絞り込みを無視して全員を返す（理由不明の空表を作らない）', async () => {
    const sc = await scenario();
    const other = await scenario(); // 別テナントのスタッフID
    for (const bogus of ['does-not-exist', other.staffIds[0]!]) {
      const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY, bogus);
      expect(w.selectedStaffId).toBeNull();
      expect(w.rows).toHaveLength(2);
      expect(w.rows.map((r) => r.staffId).sort()).toEqual([...sc.staffIds].sort());
    }
  });

  it('予約件数がスタッフ×日で集計される', async () => {
    const sc = await scenario();
    await addBooking(sc, { date: WEDNESDAY, staffId: sc.staffIds[0]!, name: '山田太郎' });
    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const wed = w.columns.findIndex((c) => c.date === WEDNESDAY);
    const withBooking = w.rows.find((r) => r.staffId === sc.staffIds[0]!)!;
    const without = w.rows.find((r) => r.staffId === sc.staffIds[1]!)!;
    expect(withBooking.days[wed]!.bookingCount).toBe(1);
    expect(without.days[wed]!.bookingCount).toBe(0);
    expect(withBooking.days[0]!.bookingCount).toBe(0);
  });
});

describe('日次タイムライン', () => {
  it('各レーンに勤務時間が付く', async () => {
    const sc = await scenario();
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    expect(d.lanes).toHaveLength(2);
    for (const lane of d.lanes) {
      expect(lane.shifts).toEqual([{ startMin: 600, endMin: 1140 }]);
    }
  });

  it('欠勤のスタッフはレーンに残るが勤務時間が空（居ないのではなく休み）', async () => {
    const sc = await scenario();
    await prisma.staffSchedule.create({
      data: {
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        staffId: sc.staffIds[0]!,
        type: 'OVERRIDE',
        date: dateObj(MONDAY),
        isWorking: false,
      },
    });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const lane = d.lanes.find((l) => l.key === sc.staffIds[0]!)!;
    expect(lane).toBeTruthy();
    expect(lane.shifts).toEqual([]);
  });

  it('休業日は理由付きで閉じる', async () => {
    const sc = await scenario();
    await prisma.specialBusinessDay.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, date: dateObj(MONDAY), type: 'CLOSED', reason: '研修' },
    });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    expect(d.isClosed).toBe(true);
    expect(d.closedLabel).toBe('臨時休業');
  });

  it('休業日でも予約が残っていれば閉じずに表示する（店主が対応できるように）', async () => {
    const sc = await scenario();
    await addBooking(sc, { date: MONDAY, staffId: sc.staffIds[0]!, name: '既存予約' });
    await prisma.specialBusinessDay.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, date: dateObj(MONDAY), type: 'CLOSED', reason: '研修' },
    });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    expect(d.isClosed).toBe(false);
    expect(d.closedLabel).toBe('臨時休業');
    const lane = d.lanes.find((l) => l.key === sc.staffIds[0]!)!;
    expect(lane.bookings).toHaveLength(1);
    expect(lane.shifts).toEqual([]); // 休業なので勤務時間は無い
  });

  it('スタッフ絞り込みはレーンと予約の両方に効く', async () => {
    const sc = await scenario();
    await addBooking(sc, { date: MONDAY, staffId: sc.staffIds[1]!, name: '別の人の客' });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY, sc.staffIds[0]!);
    expect(d.lanes).toHaveLength(1);
    expect(d.lanes[0]!.key).toBe(sc.staffIds[0]!);
    expect(d.lanes[0]!.bookings).toHaveLength(0);
    expect(d.selectedStaffId).toBe(sc.staffIds[0]!);
    expect(d.staffOptions).toHaveLength(2);
  });

  it('知らないスタッフIDは絞り込みを無視して全員のレーンを返す', async () => {
    const sc = await scenario();
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY, 'nope');
    expect(d.selectedStaffId).toBeNull();
    expect(d.lanes).toHaveLength(2);
  });

  it('担当なしの予約は「未割当」レーンに出る', async () => {
    const sc = await scenario({ requiresStaff: false });
    await addBooking(sc, { date: MONDAY, staffId: null, name: 'おまかせ客' });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const none = d.lanes.find((l) => l.key === '__none__')!;
    expect(none).toBeTruthy();
    expect(none.bookings).toHaveLength(1);
  });
});

describe('退職・停止したスタッフの予約を画面から消さない', () => {
  it('日表示: 退職者のレーンが残り、予約が見える', async () => {
    const sc = await scenario();
    await addBooking(sc, { date: MONDAY, staffId: sc.staffIds[0]!, name: '担当者が辞めた客' });
    // 退職処理（既存予約は取り消しも付け替えもしない）
    await prisma.staff.update({
      where: { id: sc.staffIds[0]! },
      data: { status: 'INACTIVE', isBookable: false, deletedAt: new Date() },
    });

    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const lane = d.lanes.find((l) => l.key === sc.staffIds[0]!);
    expect(lane).toBeTruthy();
    expect(lane!.inactive).toBe(true);
    expect(lane!.shifts).toEqual([]); // もう出勤しない
    expect(lane!.bookings).toHaveLength(1);
    expect(lane!.bookings[0]!.customerName).toBe('担当者が辞めた客');
    // 未割当に紛れ込ませない（担当は判明している）
    expect(d.lanes.find((l) => l.key === '__none__')).toBeUndefined();
  });

  it('週表示: 退職者の行が残り、予約件数が消えない', async () => {
    const sc = await scenario();
    await addBooking(sc, { date: WEDNESDAY, staffId: sc.staffIds[0]!, name: '担当者が辞めた客' });
    await prisma.staff.update({
      where: { id: sc.staffIds[0]! },
      data: { status: 'INACTIVE', isBookable: false, deletedAt: new Date() },
    });

    const w = await getWeekSchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    const wed = w.columns.findIndex((c) => c.date === WEDNESDAY);
    const row = w.rows.find((r) => r.staffId === sc.staffIds[0]!);
    expect(row).toBeTruthy();
    expect(row!.inactive).toBe(true);
    expect(row!.days[wed]!.bookingCount).toBe(1);
    expect(row!.days[wed]!.shifts).toEqual([]);
    // 稼働中のスタッフは通常どおり
    const active = w.rows.find((r) => r.staffId === sc.staffIds[1]!)!;
    expect(active.inactive).toBeUndefined();
    expect(active.days[wed]!.shifts.length).toBe(1);
  });

  it('退職者に予約が無ければ行は増えない', async () => {
    const sc = await scenario();
    await prisma.staff.update({
      where: { id: sc.staffIds[0]! },
      data: { status: 'INACTIVE', isBookable: false, deletedAt: new Date() },
    });
    const d = await getDaySchedule(sc.tenantId, sc.shopId, TZ, MONDAY);
    expect(d.lanes).toHaveLength(1);
    expect(d.lanes[0]!.key).toBe(sc.staffIds[1]!);
  });
});
