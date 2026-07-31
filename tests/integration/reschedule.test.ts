/**
 * 予約改期（rescheduleBooking）の統合テスト: 占有の付け替え・旧枠解放・満席拒否・変更期限。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, rescheduleBooking } from '@/server/services/booking-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';
import { isAppError } from '@/lib/errors';

/** AppError の message はコード。画面に出るのは userMessage なのでそちらを見る。 */
async function userMessageOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    return isAppError(e) ? e.userMessage : String((e as Error).message);
  }
  throw new Error('expected to throw');
}

const NOW = new Date('2026-07-05T00:00:00Z');
const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

describe('rescheduleBooking', () => {
  it('新時間へ移動し、旧枠を解放する', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;

    // 7/6 10:00 JST(=01:00 UTC) に予約
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });

    // 11:00 JST(=02:00 UTC) へ改期
    const r = await rescheduleBooking({
      bookingId: b.id, newStartAt: new Date('2026-07-06T02:00:00Z'), newStaffId: s0, actorType: 'USER', now: NOW,
    });
    expect(r.startAt.toISOString()).toBe('2026-07-06T02:00:00.000Z');

    // アクティブ明細は新時間に移動している
    const items = await prisma.bookingItem.findMany({ where: { bookingId: b.id, active: true }, select: { startAt: true } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.startAt.getTime() >= new Date('2026-07-06T02:00:00Z').getTime())).toBe(true);

    // RESCHEDULED イベントが記録される
    const ev = await prisma.bookingEvent.count({ where: { bookingId: b.id, type: 'RESCHEDULED' } });
    expect(ev).toBe(1);

    // 旧枠(10:00)は解放され、別予約が取れる
    const b2 = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'B', email: 'b@x.com' }, now: NOW,
    });
    expect(b2.status).toBe('CONFIRMED');
  });

  it('埋まっている枠へは改期できない（SLOT_FULL）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;

    await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });
    const bB = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T03:00:00Z'), customer: { name: 'B', email: 'b@x.com' }, now: NOW,
    });

    // bB を A の枠(10:00, 同一スタッフ)へ改期 → 満席
    await expect(
      rescheduleBooking({ bookingId: bB.id, newStartAt: new Date('2026-07-06T01:00:00Z'), newStaffId: s0, actorType: 'USER', now: NOW }),
    ).rejects.toMatchObject({ code: 'SLOT_FULL' });

    // 失敗時ロールバック: bB は元の時間のまま
    const after = await prisma.booking.findUnique({ where: { id: bB.id }, select: { startAt: true } });
    expect(after!.startAt.toISOString()).toBe('2026-07-06T03:00:00.000Z');
  });

  it('顧客の変更期限超過は拒否（enforceDeadline）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'A', email: 'a@x.com' }, now: NOW,
    });
    // 開始30分前に変更しようとする（既定の期限24hを過ぎている）
    await expect(
      rescheduleBooking({
        bookingId: b.id, newStartAt: new Date('2026-07-06T05:00:00Z'), actorType: 'CUSTOMER',
        enforceDeadline: true, now: new Date('2026-07-06T00:30:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'CANCELLATION_DEADLINE_PASSED' });
  });

  it('日時変更しても明細価格は予約時のまま（値上げが過去の売上を書き換えない）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;

    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'P', email: 'p@x.com' }, now: NOW,
    });
    const before = await prisma.bookingItem.findFirst({
      where: { bookingId: b.id, active: true }, orderBy: { sortOrder: 'asc' }, select: { priceJpy: true },
    });
    const bookedPrice = before!.priceJpy;
    expect(bookedPrice).toBe(5000); // seedScenario のメニュー価格

    // 予約後にメニューを値上げ
    await prisma.service.update({ where: { id: sc.serviceId }, data: { priceJpy: 9000 } });

    await rescheduleBooking({
      bookingId: b.id, newStartAt: new Date('2026-07-06T02:00:00Z'), newStaffId: s0, actorType: 'USER', now: NOW,
    });

    const after = await prisma.bookingItem.findFirst({
      where: { bookingId: b.id, active: true }, orderBy: { sortOrder: 'asc' }, select: { priceJpy: true },
    });
    // 「日時変更は再注文ではない」ので据え置き。現在価格(9000)で書き換わってはいけない。
    expect(after!.priceJpy).toBe(bookedPrice);

    // 予約合計と明細合計が食い違わない（同じ画面の売上カードとメニュー別が一致する条件）
    const booking = await prisma.booking.findUnique({ where: { id: b.id }, select: { totalPriceJpy: true, nominationFeeJpy: true } });
    const itemSum = await prisma.bookingItem.aggregate({
      where: { bookingId: b.id, active: true }, _sum: { priceJpy: true },
    });
    expect((itemSum._sum.priceJpy ?? 0) + booking!.nominationFeeJpy).toBe(booking!.totalPriceJpy);
  });

  it('担当が退職していたら、原因と次の一手が分かるメッセージで断る', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    created.push(sc.tenantId);
    const s0 = sc.staffIds[0]!;
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: s0,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'S', email: 's@x.com' }, now: NOW,
    });
    await prisma.staff.update({
      where: { id: s0 },
      data: { status: 'INACTIVE', isBookable: false, deletedAt: new Date() },
    });

    const msg = await userMessageOf(() =>
      rescheduleBooking({
        bookingId: b.id, newStartAt: new Date('2026-07-06T02:00:00Z'), actorType: 'CUSTOMER', now: NOW,
      }),
    );
    expect(msg).toContain('担当者');
    expect(msg).toContain('店舗へ直接'); // 次の一手を必ず示す
    // 勝手に別の担当へ振り替えない（指名した人と違う人が出てくるのを防ぐ）
    const still = await prisma.booking.findUnique({ where: { id: b.id }, select: { staffId: true, startAt: true } });
    expect(still!.staffId).toBe(s0);
    expect(still!.startAt.toISOString()).toBe('2026-07-06T01:00:00.000Z');
  });

  it('メニューが廃止されていたら、不具合ではなく状況として説明する', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    created.push(sc.tenantId);
    const b = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: sc.staffIds[0]!,
      startAt: new Date('2026-07-06T01:00:00Z'), customer: { name: 'M', email: 'm@x.com' }, now: NOW,
    });
    await prisma.service.update({ where: { id: sc.serviceId }, data: { deletedAt: new Date(), isActive: false } });

    const msg = await userMessageOf(() =>
      rescheduleBooking({
        bookingId: b.id, newStartAt: new Date('2026-07-06T02:00:00Z'), actorType: 'CUSTOMER', now: NOW,
      }),
    );
    expect(msg).toContain('メニュー内容');
    expect(msg).toContain('店舗へ直接');
  });
});
