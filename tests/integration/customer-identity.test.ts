/**
 * 顧客カルテの同定（実DB）。
 *
 * 以前は email だけで探していたため、メールを持たない予約——LINE 予約と後台の
 * 電話・飛び込み登録——が毎回新規カルテを作り、常連でも「来店回数 1 回」のままだった。
 * 来店回数・累計利用額・休眠判定が全て狂うので、ここを固定する。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, getDayAvailability } from '@/server/services/booking-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const created: string[] = [];
afterAll(async () => {
  for (const t of created) await cleanupTenant(t);
});

const NOW = new Date('2026-07-05T00:00:00Z');

async function slots(sc: { tenantId: string; shopId: string; serviceId: string }, date: string) {
  const { slots } = await getDayAvailability({
    tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date, now: NOW,
  });
  return slots.filter((s) => s.available);
}

async function book(
  sc: { tenantId: string; shopId: string; serviceId: string },
  date: string,
  idx: number,
  customer: { name: string; email?: string; phone?: string },
  lineUserId?: string,
) {
  const av = await slots(sc, date);
  return createBooking({
    tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
    startAt: av[idx]!.startAt, customer, lineUserId, now: NOW,
  });
}

const countCustomers = (tenantId: string) =>
  prisma.customer.count({ where: { tenantId, deletedAt: null } });

describe('顧客カルテの同定', () => {
  it('電話だけの常連は同じカルテにまとまる（後台の代理登録・飛び込み）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    await book(sc, '2026-07-06', 0, { name: '山田 花子', phone: '090-1234-5678' });
    await book(sc, '2026-07-07', 0, { name: '山田 花子', phone: '09012345678' }); // 表記ゆれ
    await book(sc, '2026-07-08', 0, { name: '山田 花子', phone: '090 1234 5678' });
    expect(await countCustomers(sc.tenantId)).toBe(1);
    const c = await prisma.customer.findFirst({
      where: { tenantId: sc.tenantId }, select: { phone: true, _count: { select: { bookings: true } } },
    });
    expect(c!.phone).toBe('09012345678'); // 正規化して保存
    expect(c!._count.bookings).toBe(3);
  });

  it('LINE 予約の常連は同じカルテにまとまる（メール欄が無い導線）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    await book(sc, '2026-07-06', 0, { name: 'LINE 太郎' }, 'U-line-001');
    await book(sc, '2026-07-07', 0, { name: 'LINE 太郎' }, 'U-line-001');
    expect(await countCustomers(sc.tenantId)).toBe(1);
    const c = await prisma.customer.findFirst({ where: { tenantId: sc.tenantId }, select: { lineUserId: true } });
    expect(c!.lineUserId).toBe('U-line-001');
  });

  it('メールの大文字小文字違いで別人にならない', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    await book(sc, '2026-07-06', 0, { name: '佐藤', email: 'Taro@Example.COM' });
    await book(sc, '2026-07-07', 0, { name: '佐藤', email: 'taro@example.com' });
    expect(await countCustomers(sc.tenantId)).toBe(1);
    const c = await prisma.customer.findFirst({ where: { tenantId: sc.tenantId }, select: { email: true } });
    expect(c!.email).toBe('taro@example.com');
  });

  it('別チャネルで判明した連絡先を書き戻す（次回の同定精度が上がる）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    // 1回目: 電話のみ
    await book(sc, '2026-07-06', 0, { name: '鈴木', phone: '080-1111-2222' });
    // 2回目: 同じ電話 + メール → 同一カルテにメールが埋まる
    await book(sc, '2026-07-07', 0, { name: '鈴木', phone: '08011112222', email: 'suzuki@x.jp' });
    expect(await countCustomers(sc.tenantId)).toBe(1);
    const c = await prisma.customer.findFirst({ where: { tenantId: sc.tenantId }, select: { email: true, phone: true } });
    expect(c!.email).toBe('suzuki@x.jp');
    expect(c!.phone).toBe('08011112222');
    // 3回目: メールだけでも同じカルテに繋がる
    await book(sc, '2026-07-08', 0, { name: '鈴木', email: 'suzuki@x.jp' });
    expect(await countCustomers(sc.tenantId)).toBe(1);
  });

  it('別人は別カルテのまま（過剰にまとめない）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    await book(sc, '2026-07-06', 0, { name: 'A', phone: '090-1111-1111' });
    await book(sc, '2026-07-06', 1, { name: 'B', phone: '090-2222-2222' });
    await book(sc, '2026-07-06', 2, { name: 'C', email: 'c@x.jp' });
    expect(await countCustomers(sc.tenantId)).toBe(3);
  });

  it('連絡先が一切無い予約は毎回新規（まとめる根拠が無いため）', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 3, shopCapacity: 9 });
    created.push(sc.tenantId);
    await book(sc, '2026-07-06', 0, { name: '名前だけ' });
    await book(sc, '2026-07-07', 0, { name: '名前だけ' });
    expect(await countCustomers(sc.tenantId)).toBe(2);
  });
});
