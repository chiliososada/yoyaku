/**
 * 商家後台の書込サービス統合テスト（実DB）。
 * スタッフ/サービスCRUD・店舗設定・特別営業日・営業時間・ソフトデリート・テナント隔離を検証。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import * as svc from '@/server/services/merchant-mutation-service';
import { getDayAvailability } from '@/server/services/booking-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';
import { isAppError } from '@/lib/errors';

const createdTenants: string[] = [];
beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

const baseStaff = {
  name: '新人 太郎', displayName: '太郎', email: '', phone: '', bio: '',
  isBookable: true, capacity: 1, nominationFeeJpy: 0, status: 'ACTIVE' as const, sortOrder: 0,
  serviceIds: [] as string[],
};
const baseService = {
  name: '新メニュー', category: '', description: '', durationMin: 45, bufferAfterMin: 5,
  priceJpy: 3000, salePriceJpy: null as number | null, capacity: 1, requiresStaff: true, slotIntervalMin: 15, color: '', isActive: true,
  sortOrder: 0, staffIds: [] as string[], segments: undefined,
  options: [] as { id?: string; name: string; priceJpy: number; extraDurationMin: number }[],
};

describe('スタッフ CRUD', () => {
  it('作成・担当割当・更新・ソフトデリート', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);

    const created = await svc.createStaff(sc.tenantId, sc.shopId, { ...baseStaff, serviceIds: [sc.serviceId] });
    expect(created.name).toBe('新人 太郎');
    const links = await prisma.serviceStaff.count({ where: { staffId: created.id } });
    expect(links).toBe(1);

    await svc.updateStaff(sc.tenantId, sc.shopId, created.id, { ...baseStaff, name: '改名', serviceIds: [] });
    const after = await prisma.staff.findUnique({ where: { id: created.id }, select: { name: true } });
    expect(after?.name).toBe('改名');
    expect(await prisma.serviceStaff.count({ where: { staffId: created.id } })).toBe(0);

    await svc.softDeleteStaff(sc.tenantId, sc.shopId, created.id);
    const deleted = await prisma.staff.findUnique({ where: { id: created.id }, select: { deletedAt: true, status: true } });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.status).toBe('INACTIVE');
  });

  it('作成時に営業時間から既定シフトが自動生成され、すぐ予約可能になる', async () => {
    const sc = await seedScenario({ staffCount: 0 }); // スタッフ0の状態から新規作成
    createdTenants.push(sc.tenantId);

    const created = await svc.createStaff(sc.tenantId, sc.shopId, { ...baseStaff, serviceIds: [sc.serviceId] });

    // 営業時間（全7曜日）と同数の RECURRING シフトが自動生成される
    const schedules = await prisma.staffSchedule.findMany({
      where: { staffId: created.id, type: 'RECURRING' },
      select: { dayOfWeek: true, startMinute: true, endMinute: true, isWorking: true },
    });
    expect(schedules).toHaveLength(7);
    expect(schedules.every((s) => s.isWorking)).toBe(true);

    // 指名でその日の空きスロットが実際に出る（シフト未設定なら全て × になっていた回帰）
    const day = await getDayAvailability({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceId: sc.serviceId,
      staffId: created.id,
      date: '2026-07-06', // 月曜（営業日）
      now: new Date('2026-07-05T00:00:00.000Z'), // lead/window を確定させる
    });
    expect(day.slots.some((s) => s.available)).toBe(true);
  });

  it('別テナントのスタッフは更新できない（データ隔離）', async () => {
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);
    const staff = await svc.createStaff(a.tenantId, a.shopId, baseStaff);
    // テナントBの権限でAのスタッフを更新しようとする → NotFound
    await expect(svc.updateStaff(b.tenantId, b.shopId, staff.id, baseStaff)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('同一テナント内でも別店舗のリソースは越境更新・削除できない（NOT_FOUND）', async () => {
    const sc = await seedScenario({ staffCount: 1 }); // 店舗A
    createdTenants.push(sc.tenantId);
    // 同一テナントに店舗Bを直接作成（プラン上限を避けてDBに用意）
    const shopB = await prisma.shop.create({
      data: { tenantId: sc.tenantId, slug: `shop-b-${Date.now()}`, name: '店舗B', timezone: 'Asia/Tokyo', status: 'PUBLISHED', settings: { shopCapacity: 1 } },
    });
    await prisma.bookingCapacityRule.create({
      data: { tenantId: sc.tenantId, shopId: shopB.id, scope: 'SHOP', maxConcurrent: 1, slotIntervalMin: 15, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24 },
    });
    const staffB = await svc.createStaff(sc.tenantId, shopB.id, baseStaff);
    const serviceB = await svc.createService(sc.tenantId, shopB.id, { ...baseService, requiresStaff: false, staffIds: [] });
    const ruleB = await prisma.bookingCapacityRule.findFirst({ where: { shopId: shopB.id, scope: 'SHOP' }, select: { id: true } });

    // 店舗A のスコープ(sc.shopId)で 店舗B のリソースを操作 → すべて NOT_FOUND
    const capInput = { maxConcurrent: 5, slotIntervalMin: 15, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24 };
    await expect(svc.updateStaff(sc.tenantId, sc.shopId, staffB.id, baseStaff)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.softDeleteStaff(sc.tenantId, sc.shopId, staffB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.updateService(sc.tenantId, sc.shopId, serviceB.id, { ...baseService, requiresStaff: false, staffIds: [] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.updateCapacityRule(sc.tenantId, sc.shopId, ruleB!.id, capInput)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.addStaffOverride(sc.tenantId, sc.shopId, staffB.id, { date: '2026-09-08', isWorking: false })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.setStaffLogin(sc.tenantId, sc.shopId, staffB.id, `x_${Date.now()}@e.test`, 'password123')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // 正しい店舗スコープ(shopB.id)なら成功
    const okB = await svc.updateStaff(sc.tenantId, shopB.id, staffB.id, { ...baseStaff, name: 'B更新' });
    expect(okB.name).toBe('B更新');
  });
});

describe('サービス CRUD（segments含む）', () => {
  it('多時間帯 segments を保存・更新できる', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    createdTenants.push(sc.tenantId);

    const created = await svc.createService(sc.tenantId, sc.shopId, {
      ...baseService,
      staffIds: sc.staffIds,
      segments: [{ offsetMin: 0, durationMin: 30 }, { offsetMin: 50, durationMin: 20 }],
    });
    const row = await prisma.service.findUnique({ where: { id: created.id }, select: { segments: true } });
    expect(Array.isArray(row?.segments)).toBe(true);
    expect((row?.segments as { offsetMin: number }[]).length).toBe(2);
    expect(await prisma.serviceStaff.count({ where: { serviceId: created.id } })).toBe(2);

    await svc.updateService(sc.tenantId, sc.shopId, created.id, { ...baseService, staffIds: [sc.staffIds[0]!], segments: undefined });
    expect(await prisma.serviceStaff.count({ where: { serviceId: created.id } })).toBe(1);
  });
});

/** 店舗設定の必須項目をまとめた入力。slug 以外は既定値でよい。 */
const baseSettings = (slug: string) => ({
  slug,
  name: 'テスト店舗', description: '', phone: '', email: '',
  postalCode: '', prefecture: '', city: '', address: '',
  status: 'PUBLISHED' as const, publicBookingEnabled: true, closeOnNationalHolidays: true, shopCapacity: 1,
});

describe('店舗設定 / 特別営業日 / 営業時間', () => {
  it('店舗設定を更新（shopCapacity は settings に保存）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await svc.updateShopSettings(sc.tenantId, sc.shopId, {
      slug: sc.shopSlug, // URLは変えない
      name: '更新後店舗', description: '', phone: '', email: '', postalCode: '', prefecture: '', city: '', address: '',
      status: 'PUBLISHED', publicBookingEnabled: true, closeOnNationalHolidays: false, shopCapacity: 7,
    });
    const shop = await prisma.shop.findUnique({ where: { id: sc.shopId }, select: { name: true, settings: true, closeOnNationalHolidays: true } });
    expect(shop?.name).toBe('更新後店舗');
    expect((shop?.settings as { shopCapacity: number }).shopCapacity).toBe(7);
    expect(shop?.closeOnNationalHolidays).toBe(false);
  });

  it('公開URL(slug)を変更できる。予約・スタッフ・メニューは同じ店舗のまま残る', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const staffBefore = await prisma.staff.count({ where: { shopId: sc.shopId } });

    await svc.updateShopSettings(sc.tenantId, sc.shopId, {
      ...baseSettings(sc.shopSlug), slug: 'renamed-shinbashi',
    });

    const shop = await prisma.shop.findUnique({ where: { id: sc.shopId }, select: { slug: true } });
    expect(shop?.slug).toBe('renamed-shinbashi');
    // 店舗IDは変わらないので、ぶら下がっているものは全部そのまま
    expect(await prisma.staff.count({ where: { shopId: sc.shopId } })).toBe(staffBefore);
    expect(await prisma.service.count({ where: { shopId: sc.shopId } })).toBeGreaterThan(0);
  });

  it('URLを変えずに保存しても「使用中」にならない（自分自身を重複と数えない）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    // 同じ slug のまま2回保存する。createShop の重複チェックをそのまま流用すると
    // 自分自身を「使用中」と数えてしまい、URLを触っていないのに保存できなくなる（実測で再現済み）。
    await svc.updateShopSettings(sc.tenantId, sc.shopId, baseSettings(sc.shopSlug));
    await svc.updateShopSettings(sc.tenantId, sc.shopId, { ...baseSettings(sc.shopSlug), name: '2回目' });
    const shop = await prisma.shop.findUnique({ where: { id: sc.shopId }, select: { slug: true, name: true } });
    expect(shop?.slug).toBe(sc.shopSlug);
    expect(shop?.name).toBe('2回目');
  });

  it('他店舗が使っているURLは拒否する（テナントをまたいでも一意）', async () => {
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);

    await expect(
      svc.updateShopSettings(a.tenantId, a.shopId, { ...baseSettings(a.shopSlug), slug: b.shopSlug }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 失敗しても元のURLは書き換わっていない
    const shop = await prisma.shop.findUnique({ where: { id: a.shopId }, select: { slug: true } });
    expect(shop?.slug).toBe(a.shopSlug);
  });

  it('手放したURLは別の店舗が取得できない（旧URLの客が別の店へ流れない）', async () => {
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);
    const released = a.shopSlug;

    // A店がURLを変更 → 旧URLが空く
    await svc.updateShopSettings(a.tenantId, a.shopId, { ...baseSettings(released), slug: `${released}-honten` });

    // 別テナントのB店がそれを拾おうとしても拒否される。
    // 拾えてしまうと、A店のポスターのQRを読んだ客がB店に予約を入れ、
    // 氏名・電話・メールがB店のテナントへ保存される。
    await expect(
      svc.updateShopSettings(b.tenantId, b.shopId, { ...baseSettings(b.shopSlug), slug: released }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 新規作成の経路からも取れない
    await expect(
      svc.createShop(b.tenantId, { name: '横取り店', slug: released, timezone: 'Asia/Tokyo' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // 旧URLはどの店舗も解決しない（404のまま）
    expect(await prisma.shop.findFirst({ where: { slug: released } })).toBeNull();
  });

  it('自分が手放したURLには戻せる', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const first = sc.shopSlug;

    await svc.updateShopSettings(sc.tenantId, sc.shopId, { ...baseSettings(first), slug: `${first}-b` });
    await svc.updateShopSettings(sc.tenantId, sc.shopId, { ...baseSettings(`${first}-b`), slug: first });

    const shop = await prisma.shop.findUnique({ where: { id: sc.shopId }, select: { slug: true } });
    expect(shop?.slug).toBe(first);
    // 戻したURLは履歴から外れている（現URLと履歴の二重持ちを作らない）
    expect(await prisma.shopSlugHistory.findFirst({ where: { slug: first } })).toBeNull();
    // 手放した方は履歴に残る
    expect(await prisma.shopSlugHistory.findFirst({ where: { slug: `${first}-b` } })).not.toBeNull();
  });

  it('URL重複で弾かれたとき、席数だけ書き換わった状態が残らない', async () => {
    const a = await seedScenario({ staffCount: 1, shopCapacity: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);
    const ruleBefore = await prisma.bookingCapacityRule.findFirstOrThrow({
      where: { shopId: a.shopId, scope: 'SHOP', serviceId: null, staffId: null },
      select: { maxConcurrent: true },
    });

    await expect(
      svc.updateShopSettings(a.tenantId, a.shopId, {
        ...baseSettings(a.shopSlug), slug: b.shopSlug, shopCapacity: ruleBefore.maxConcurrent + 5,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const ruleAfter = await prisma.bookingCapacityRule.findFirstOrThrow({
      where: { shopId: a.shopId, scope: 'SHOP', serviceId: null, staffId: null },
      select: { maxConcurrent: true },
    });
    expect(ruleAfter.maxConcurrent).toBe(ruleBefore.maxConcurrent);
  });

  it('同時に同じURLを取ろうとしても、成立するのは1店舗だけ', async () => {
    // 「事前チェック → update」の間に相手が入り込む競合。アプリ側の確認だけでは防げず、
    // 最後は DB の一意制約(shops_slug_key)が効いているかどうかで決まる。
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    createdTenants.push(a.tenantId, b.tenantId);
    const wanted = `race-${Date.now().toString(36)}`;

    const results = await Promise.allSettled([
      svc.updateShopSettings(a.tenantId, a.shopId, { ...baseSettings(a.shopSlug), slug: wanted }),
      svc.updateShopSettings(b.tenantId, b.shopId, { ...baseSettings(b.shopSlug), slug: wanted }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    // 負けた側には生の P2002 ではなく、直せる日本語が返る
    const err = (lost[0] as PromiseRejectedResult).reason as unknown;
    expect(isAppError(err) && err.code).toBe('CONFLICT');
    expect(isAppError(err) && err.userMessage).toContain('URL');

    // DB 上でもその URL を持つ店舗はちょうど1件
    expect(await prisma.shop.count({ where: { slug: wanted } })).toBe(1);
  });

  it('特別営業日の追加(upsert)と削除', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await svc.addSpecialDay(sc.tenantId, sc.shopId, { date: '2026-12-31', type: 'CLOSED', reason: '年末' });
    expect(await prisma.specialBusinessDay.count({ where: { shopId: sc.shopId } })).toBe(1);
    // 同日 upsert
    await svc.addSpecialDay(sc.tenantId, sc.shopId, { date: '2026-12-31', type: 'SPECIAL_OPEN', openMinute: 600, closeMinute: 900 });
    expect(await prisma.specialBusinessDay.count({ where: { shopId: sc.shopId } })).toBe(1);
    const row = await prisma.specialBusinessDay.findFirstOrThrow({ where: { shopId: sc.shopId }, select: { id: true } });
    await svc.deleteSpecialDay(sc.tenantId, sc.shopId, row.id);
    expect(await prisma.specialBusinessDay.count({ where: { shopId: sc.shopId } })).toBe(0);
  });

  it('営業時間を全置換', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await svc.replaceBusinessHours(sc.tenantId, sc.shopId, {
      rows: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 720 },
        { dayOfWeek: 1, openMinute: 780, closeMinute: 1140 },
      ],
    });
    const rows = await prisma.businessHours.findMany({ where: { shopId: sc.shopId } });
    expect(rows.length).toBe(2);
  });

  it('スタッフシフト: 曜日全置換 + 特定日欠勤で予約不可になる（エンジン連動）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const date = '2026-09-08';
    const now = new Date('2026-09-03T00:00:00.000Z');

    // 初期は空きあり
    const before = await getDayAvailability({ tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date, now });
    expect(before.slots.some((s) => s.available)).toBe(true);

    // 当該スタッフを当日欠勤に
    await svc.addStaffOverride(sc.tenantId, sc.shopId, sc.staffIds[0]!, { date, isWorking: false });

    const after = await getDayAvailability({ tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date, now });
    expect(after.slots.every((s) => !s.available)).toBe(true);

    // 曜日シフトの全置換（月のみ）
    await svc.replaceStaffRecurringSchedule(sc.tenantId, sc.shopId, sc.staffIds[0]!, {
      rows: [{ dayOfWeek: 1, startMinute: 600, endMinute: 1140 }],
    });
    const recurring = await prisma.staffSchedule.count({ where: { staffId: sc.staffIds[0]!, type: 'RECURRING' } });
    expect(recurring).toBe(1);
  });

  it('容量ルールを更新', async () => {
    const sc = await seedScenario({ staffCount: 1, shopCapacity: 3 });
    createdTenants.push(sc.tenantId);
    const rule = await prisma.bookingCapacityRule.findFirst({ where: { shopId: sc.shopId, scope: 'SHOP' }, select: { id: true } });
    await svc.updateCapacityRule(sc.tenantId, sc.shopId, rule!.id, {
      maxConcurrent: 9, slotIntervalMin: 30, bookingWindowDays: 14, leadTimeMinHours: 3, cancellationDeadlineHours: 48,
    });
    const updated = await prisma.bookingCapacityRule.findUnique({ where: { id: rule!.id }, select: { maxConcurrent: true, bookingWindowDays: true } });
    expect(updated?.maxConcurrent).toBe(9);
    expect(updated?.bookingWindowDays).toBe(14);
    // 別テナントは更新不可
    const other = await seedScenario({ staffCount: 1 });
    createdTenants.push(other.tenantId);
    await expect(svc.updateCapacityRule(other.tenantId, other.shopId, rule!.id, {
      maxConcurrent: 1, slotIntervalMin: 15, bookingWindowDays: 30, leadTimeMinHours: 2, cancellationDeadlineHours: 24,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * 休業・欠勤を登録したとき、その日に既に入っている予約を店主へ知らせる。
 * **自動キャンセルはしない**（客への連絡なしに来店を無にするのは取り返しがつかない）。
 * 件数だけを返し、判断と連絡は店主に委ねる。
 */
describe('休業・欠勤の登録は既存予約の件数を返す', () => {
  const bookOn = async (
    sc: { tenantId: string; shopId: string; serviceId: string },
    startAt: Date,
    staffId?: string,
  ) => {
    const customer = await prisma.customer.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, name: 'x', email: `w${Math.random()}@t.test` },
    });
    await prisma.booking.create({
      data: {
        tenantId: sc.tenantId, shopId: sc.shopId, customerId: customer.id, serviceId: sc.serviceId,
        startAt, endAt: new Date(startAt.getTime() + 3600_000),
        status: 'CONFIRMED', totalPriceJpy: 1000, customerName: 'x',
        ...(staffId ? { staffId } : {}),
      },
    });
  };

  it('臨時休業: その日の予約件数を返す（予約は消さない）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    // JST 2026-10-05 の 11:00 と 14:00
    await bookOn(sc, new Date('2026-10-05T02:00:00Z'));
    await bookOn(sc, new Date('2026-10-05T05:00:00Z'));
    // 別日は数えない
    await bookOn(sc, new Date('2026-10-06T02:00:00Z'));

    const res = await svc.addSpecialDay(sc.tenantId, sc.shopId, {
      date: '2026-10-05', type: 'CLOSED', reason: '研修',
    });
    expect(res.affectedBookings).toBe(2);
    // 予約は消えていない
    expect(await prisma.booking.count({ where: { shopId: sc.shopId, status: 'CONFIRMED' } })).toBe(3);
  });

  it('特別営業（休業ではない）は件数を数えない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await bookOn(sc, new Date('2026-10-07T02:00:00Z'));
    const res = await svc.addSpecialDay(sc.tenantId, sc.shopId, {
      date: '2026-10-07', type: 'SPECIAL_OPEN', openMinute: 600, closeMinute: 900,
    });
    expect(res.affectedBookings).toBe(0);
  });

  it('スタッフ欠勤: その人のその日の予約だけを数える', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    createdTenants.push(sc.tenantId);
    const [a, b] = sc.staffIds;
    await bookOn(sc, new Date('2026-10-08T02:00:00Z'), a);
    await bookOn(sc, new Date('2026-10-08T05:00:00Z'), a);
    await bookOn(sc, new Date('2026-10-08T02:00:00Z'), b); // 別スタッフは数えない

    const res = await svc.addStaffOverride(sc.tenantId, sc.shopId, a!, {
      date: '2026-10-08', isWorking: false,
    });
    expect(res.affectedBookings).toBe(2);
    expect(await prisma.booking.count({ where: { shopId: sc.shopId, status: 'CONFIRMED' } })).toBe(3);
  });

  it('出勤登録（欠勤ではない）は件数を数えない', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    await bookOn(sc, new Date('2026-10-09T02:00:00Z'), sc.staffIds[0]);
    const res = await svc.addStaffOverride(sc.tenantId, sc.shopId, sc.staffIds[0]!, {
      date: '2026-10-09', isWorking: true, startMinute: 600, endMinute: 1140,
    });
    expect(res.affectedBookings).toBe(0);
  });
});

describe('メニューの担当スタッフ: 文脈を見て判定する', () => {
  const svcInput = (over: Record<string, unknown> = {}) => ({
    name: 'テストメニュー',
    category: '',
    description: '',
    durationMin: 60,
    bufferAfterMin: 0,
    priceJpy: 4000,
    salePriceJpy: null,
    capacity: 1,
    requiresStaff: true,
    slotIntervalMin: 15,
    color: '',
    isActive: true,
    sortOrder: 0,
    staffIds: [] as string[],
    options: [],
    ...over,
  });

  it('スタッフが1人も居ない店では、担当0名でも保存できる（開店準備を止めない）', async () => {
    const sc = await seedScenario({ staffCount: 0 });
    createdTenants.push(sc.tenantId);
    const created = await svc.createService(sc.tenantId, sc.shopId, svcInput() as never);
    expect(created.id).toBeTruthy();
    expect(created.requiresStaff).toBe(true);
  });

  it('スタッフが居るのに0名選択は拒否する（選び忘れは入力ミス）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    let msg = '';
    try {
      await svc.createService(sc.tenantId, sc.shopId, svcInput() as never);
      throw new Error('expected to throw');
    } catch (e) {
      msg = isAppError(e) ? e.userMessage : String((e as Error).message);
    }
    expect(msg).toContain('担当スタッフを1名以上');
    // 逃げ道も文言で示す
    expect(msg).toContain('チェックを外して');
  });

  it('担当不要にすればスタッフが居ても0名で保存できる', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const created = await svc.createService(
      sc.tenantId,
      sc.shopId,
      svcInput({ requiresStaff: false }) as never,
    );
    expect(created.requiresStaff).toBe(false);
  });

  it('更新でも同じ判定（スタッフ登録後に0名へ戻すのは拒否）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const created = await svc.createService(
      sc.tenantId,
      sc.shopId,
      svcInput({ staffIds: [sc.staffIds[0]!] }) as never,
    );
    await expect(
      svc.updateService(sc.tenantId, sc.shopId, created.id, svcInput({ staffIds: [] }) as never),
    ).rejects.toThrow();
  });
});
