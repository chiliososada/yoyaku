/**
 * コンボ予約（複数サービス連続）・オプション・指名料の統合テスト（実DB）。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  getDayAvailability,
  createBooking,
  getBookingByToken,
} from '@/server/services/booking-service';
import { seedScenario, addServiceToScenario, cleanupTenant } from '../helpers/seed';

const DATE = '2026-09-08';
const NOW = new Date('2026-09-03T00:00:00.000Z');
const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

describe('コンボ予約: 連続占有と明細', () => {
  it('カット+カラー: 明細がサービス順に連続し、価格が正しく分解される', async () => {
    // ベース: 60分 ¥5,000 buffer0（seed既定）→ bufferAfter 10 に更新
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.service.update({ where: { id: sc.serviceId }, data: { bufferAfterMin: 10 } });
    const extra = await addServiceToScenario(sc, {
      name: 'カラー',
      durationMin: 120,
      segments: [
        { offsetMin: 0, durationMin: 40 },
        { offsetMin: 60, durationMin: 60 },
      ],
      bufferAfterMin: 10,
      priceJpy: 8000,
    });

    const startAt = new Date('2026-09-08T00:00:00.000Z'); // 9:00 JST
    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }, { serviceId: extra.serviceId }],
      staffId: null,
      startAt,
      customer: { name: 'コンボ客', email: 'combo@test.com' },
      now: NOW,
    });

    // 価格 = 5000 + 8000
    expect(b.totalPriceJpy).toBe(13_000);
    // 占有終端 = 9:00 + 60 + 10 + (セグメント末端120) + 10 = 12:20 JST = 03:20Z
    expect(b.endAt.toISOString()).toBe('2026-09-08T03:20:00.000Z');

    const items = await prisma.bookingItem.findMany({
      where: { bookingId: b.id },
      orderBy: { sortOrder: 'asc' },
      select: { serviceId: true, startAt: true, endAt: true, priceJpy: true },
    });
    expect(items).toHaveLength(3); // カット1 + カラー2セグメント
    expect(items[0]!.serviceId).toBe(sc.serviceId);
    expect(items[0]!.priceJpy).toBe(5000);
    expect(items[1]!.serviceId).toBe(extra.serviceId);
    expect(items[1]!.priceJpy).toBe(8000);
    expect(items[2]!.priceJpy).toBe(0);
    // カラーはカットの占有終端(9:00+70=10:10 JST=01:10Z)から
    expect(items[1]!.startAt.toISOString()).toBe('2026-09-08T01:10:00.000Z');
  });

  it('営業終了間際: 単品は可でもコンボは不可（連続時間が収まらない）', async () => {
    const sc = await seedScenario({ staffCount: 1, closeMinute: 720 }); // 9:00-12:00
    createdTenants.push(sc.tenantId);
    const extra = await addServiceToScenario(sc, { durationMin: 60 });

    // 単品(60分): 11:00 開始可（12:00 close きっかり）
    const single = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      date: DATE, now: NOW,
    });
    const at11 = single.slots.find((s) => s.startAt.toISOString() === '2026-09-08T02:00:00.000Z');
    expect(at11?.available).toBe(true);

    // コンボ(60+60): 11:00 開始はそもそもスロット生成されない（12:00 に収まらない）
    const combo = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }, { serviceId: extra.serviceId }],
      date: DATE, now: NOW,
    });
    expect(combo.slots.some((s) => s.startAt.toISOString() === '2026-09-08T02:00:00.000Z')).toBe(false);
    // 10:00 開始（10:00+120=12:00）は可
    const at10 = combo.slots.find((s) => s.startAt.toISOString() === '2026-09-08T01:00:00.000Z');
    expect(at10?.available).toBe(true);
  });

  it('おまかせコンボ: 全サービスを担当できるスタッフのみ割当られる', async () => {
    const sc = await seedScenario({ staffCount: 2, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    // 2つ目のサービスはスタッフ2(index 1)のみ担当
    const extra = await addServiceToScenario(sc, { durationMin: 30, staffIndexes: [1] });

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }, { serviceId: extra.serviceId }],
      staffId: null,
      startAt: new Date('2026-09-08T00:00:00.000Z'),
      customer: { name: '交差客', email: 'intersect@test.com' },
      now: NOW,
    });
    // 両方できるのはスタッフ2だけ
    expect(b.staffId).toBe(sc.staffIds[1]);

    // 片方しか担当できないスタッフ1の指名は拒否
    await expect(
      createBooking({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceItems: [{ serviceId: sc.serviceId }, { serviceId: extra.serviceId }],
        staffId: sc.staffIds[0],
        startAt: new Date('2026-09-08T04:00:00.000Z'),
        customer: { name: '指名客', email: 'nominate-x@test.com' },
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'STAFF_UNAVAILABLE' });
  });
});

describe('オプションと指名料', () => {
  it('オプションが時間を延長し、価格に加算され、スナップショットが残る', async () => {
    const sc = await seedScenario({ staffCount: 1, closeMinute: 720 }); // 9:00-12:00
    createdTenants.push(sc.tenantId);
    const extra = await addServiceToScenario(sc, {
      durationMin: 60,
      priceJpy: 3000,
      options: [{ name: '延長30分', priceJpy: 2000, extraDurationMin: 30 }],
    });
    const optId = extra.optionIds[0]!;

    // オプションなし: 11:00 開始可
    const noOpt = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: extra.serviceId }],
      date: DATE, now: NOW,
    });
    expect(
      noOpt.slots.find((s) => s.startAt.toISOString() === '2026-09-08T02:00:00.000Z')?.available,
    ).toBe(true);

    // オプションあり(90分): 11:00 はスロット自体が生成されない
    const withOpt = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: extra.serviceId, optionIds: [optId] }],
      date: DATE, now: NOW,
    });
    expect(
      withOpt.slots.some((s) => s.startAt.toISOString() === '2026-09-08T02:00:00.000Z'),
    ).toBe(false);

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: extra.serviceId, optionIds: [optId] }],
      staffId: null,
      startAt: new Date('2026-09-08T00:00:00.000Z'),
      customer: { name: 'オプ客', email: 'opt@test.com' },
      now: NOW,
    });
    expect(b.totalPriceJpy).toBe(5000); // 3000 + 2000
    // 占有終端 = 9:00 + 90分 = 10:30 JST
    expect(b.endAt.toISOString()).toBe('2026-09-08T01:30:00.000Z');

    // スナップショット行
    const snap = await prisma.bookingItemOption.findMany({
      where: { bookingItem: { bookingId: b.id } },
      select: { name: true, priceJpy: true, optionId: true },
    });
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ name: '延長30分', priceJpy: 2000, optionId: optId });

    // 公開詳細の内訳
    const detail = await getBookingByToken(b.cancellationToken, NOW);
    expect(detail.lineItems[0]!.priceJpy).toBe(3000);
    expect(detail.lineItems[0]!.options[0]).toEqual({ name: '延長30分', priceJpy: 2000 });
  });

  it('セール価格: 予約はセール価格で請求され、オプションは通常価格のまま', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    // 通常 ¥5,000 → セール ¥4,200。オプション ¥1,000 は割引対象外。
    await prisma.service.update({ where: { id: sc.serviceId }, data: { salePriceJpy: 4200 } });
    const opt = await prisma.serviceOption.create({
      data: { tenantId: sc.tenantId, serviceId: sc.serviceId, name: '延長', priceJpy: 1000, extraDurationMin: 0, sortOrder: 0 },
    });

    const b = await createBooking({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId, optionIds: [opt.id] }],
      staffId: null,
      startAt: new Date('2026-09-08T00:00:00.000Z'),
      customer: { name: 'セール客', email: 'sale@test.com' },
      now: NOW,
    });
    // セール価格4200 + オプション1000（オプションは割引しない）
    expect(b.totalPriceJpy).toBe(5200);

    const detail = await getBookingByToken(b.cancellationToken, NOW);
    expect(detail.lineItems[0]!.priceJpy).toBe(4200); // 本体はセール価格で請求
    expect(detail.lineItems[0]!.options[0]).toEqual({ name: '延長', priceJpy: 1000 });
  });

  it('指名時のみ指名料が加算される', async () => {
    const sc = await seedScenario({ staffCount: 2, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    await prisma.staff.update({ where: { id: sc.staffIds[0]! }, data: { nominationFeeJpy: 500 } });

    // 指名: +500
    const nominated = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: sc.staffIds[0],
      startAt: new Date('2026-09-08T00:00:00.000Z'),
      customer: { name: '指名客', email: 'fee@test.com' },
      now: NOW,
    });
    expect(nominated.totalPriceJpy).toBe(5500);

    const row = await prisma.booking.findUnique({
      where: { id: nominated.id },
      select: { nominationFeeJpy: true },
    });
    expect(row?.nominationFeeJpy).toBe(500);

    // おまかせ: 指名料なし（自動でスタッフ1が割当られても加算しない）
    const auto = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId,
      serviceItems: [{ serviceId: sc.serviceId }],
      staffId: null,
      startAt: new Date('2026-09-08T04:00:00.000Z'),
      customer: { name: 'おまかせ客', email: 'nofee@test.com' },
      now: NOW,
    });
    expect(auto.totalPriceJpy).toBe(5000);
  });
});
