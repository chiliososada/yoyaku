/**
 * 並行予約テスト（防超卖の検証）。
 * 実DB（docker compose の postgres）を使用。
 *
 * 検証する性質:
 *  - スタッフ容量1: 同一枠に N 人が同時に予約 → 成功は厳密に1件
 *  - 店舗/サービス容量 C: N 件同時 → 成功は厳密に C 件
 *  - DB の active な占有が容量を超えない（オーバーブッキングゼロ）
 *  - idempotencyKey 同時重複 → 予約は1件のみ
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking } from '@/server/services/booking-service';
import { isAppError } from '@/lib/errors';
import { seedScenario, cleanupTenant } from '../helpers/seed';

// 2026-09-01 10:00 JST = 2026-09-01T01:00:00Z（祝日なし・全曜日営業）
const SLOT = new Date('2026-09-01T01:00:00.000Z');
const NOW = new Date('2026-08-27T00:00:00.000Z'); // 5日前（window/lead OK）

const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`; // 接続確認
});

afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

async function countActiveOverlapping(shopId: string): Promise<number> {
  const rows = await prisma.bookingItem.findMany({
    where: { shopId, active: true, startAt: { lt: new Date('2026-09-01T02:00:00.000Z') }, endAt: { gt: SLOT } },
    select: { bookingId: true },
  });
  return new Set(rows.map((r) => r.bookingId)).size;
}

describe('並行予約: スタッフ容量1（最後の1枠の奪い合い）', () => {
  it('8人同時 → 成功は厳密に1件、残りは満席エラー', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);

    const N = 8;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        createBooking({
          tenantId: sc.tenantId,
          shopId: sc.shopId,
          serviceId: sc.serviceId,
          staffId: null, // おまかせ
          startAt: SLOT,
          customer: { name: `客${i}`, email: `user${i}@test.com` },
          now: NOW,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const ng = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(ok).toHaveLength(1);
    expect(ng).toHaveLength(N - 1);
    // 失敗はすべて業務エラー（満席/スタッフ不可）であること
    for (const r of ng) {
      expect(isAppError(r.reason)).toBe(true);
      expect(['SLOT_FULL', 'STAFF_UNAVAILABLE']).toContain(r.reason.code);
    }
    // DB 上のオーバーブッキングがゼロ
    expect(await countActiveOverlapping(sc.shopId)).toBe(1);
  });
});

describe('並行予約: 店舗容量3', () => {
  it('10件同時 → 成功は厳密に3件', async () => {
    const sc = await seedScenario({
      staffCount: 5, // スタッフは十分（店舗容量が律速）
      staffCapacity: 1,
      shopCapacity: 3,
      serviceCapacity: 3,
    });
    createdTenants.push(sc.tenantId);

    const N = 10;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        createBooking({
          tenantId: sc.tenantId,
          shopId: sc.shopId,
          serviceId: sc.serviceId,
          staffId: null,
          startAt: SLOT,
          customer: { name: `客${i}`, email: `s3-user${i}@test.com` },
          now: NOW,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(3);
    expect(await countActiveOverlapping(sc.shopId)).toBe(3);
  });
});

describe('並行予約: idempotencyKey', () => {
  it('同一キーで2件同時 → 予約は1件のみ、両者同じID', async () => {
    const sc = await seedScenario({ staffCount: 2, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);

    const key = `idem-${Date.now()}`;
    const [a, b] = await Promise.all([
      createBooking({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceId: sc.serviceId,
        staffId: null,
        startAt: SLOT,
        customer: { name: '客A', email: 'idem@test.com' },
        idempotencyKey: key,
        now: NOW,
      }),
      createBooking({
        tenantId: sc.tenantId,
        shopId: sc.shopId,
        serviceId: sc.serviceId,
        staffId: null,
        startAt: SLOT,
        customer: { name: '客A', email: 'idem@test.com' },
        idempotencyKey: key,
        now: NOW,
      }),
    ]);

    expect(a.id).toBe(b.id);
    const count = await prisma.booking.count({ where: { shopId: sc.shopId, idempotencyKey: key } });
    expect(count).toBe(1);
  });
});

describe('並行予約: 高並行ストレス（容量5に20件）', () => {
  it('20件同時 → 成功は厳密に5件、DBオーバーブッキングなし', async () => {
    const sc = await seedScenario({
      staffCount: 10, // スタッフ供給は十分 → shop/service 容量(5)が律速
      staffCapacity: 1,
      shopCapacity: 5,
      serviceCapacity: 5,
    });
    createdTenants.push(sc.tenantId);

    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        createBooking({
          tenantId: sc.tenantId,
          shopId: sc.shopId,
          serviceId: sc.serviceId,
          staffId: null,
          startAt: SLOT,
          customer: { name: `客${i}`, email: `stress-${i}@test.com` },
          now: NOW,
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(5);
    expect(await countActiveOverlapping(sc.shopId)).toBe(5);
  });
});

describe('GiST 排他制約（DB最終防御線）', () => {
  it('同一スタッフの重複時間帯を直接挿入しようとすると DB が拒否する', async () => {
    const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
    createdTenants.push(sc.tenantId);
    const staffId = sc.staffIds[0]!;
    const cust = await prisma.customer.create({
      data: { tenantId: sc.tenantId, shopId: sc.shopId, name: '直接挿入' },
    });

    const t1s = new Date('2026-10-01T01:00:00.000Z');
    const t1e = new Date('2026-10-01T02:00:00.000Z');
    // 1件目（正常）
    await prisma.booking.create({
      data: {
        tenantId: sc.tenantId, shopId: sc.shopId, customerId: cust.id, serviceId: sc.serviceId, staffId,
        status: 'CONFIRMED', source: 'ADMIN', startAt: t1s, endAt: t1e, partySize: 1, totalPriceJpy: 0, customerName: '直接挿入',
        items: { create: { tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId, startAt: t1s, endAt: t1e, serviceEndAt: t1e, active: true } },
      },
    });

    // 2件目: 同一スタッフ・重複時間帯をアプリ層を迂回して直接挿入 → 排他制約で失敗
    const t2s = new Date('2026-10-01T01:30:00.000Z');
    const t2e = new Date('2026-10-01T02:30:00.000Z');
    await expect(
      prisma.booking.create({
        data: {
          tenantId: sc.tenantId, shopId: sc.shopId, customerId: cust.id, serviceId: sc.serviceId, staffId,
          status: 'CONFIRMED', source: 'ADMIN', startAt: t2s, endAt: t2e, partySize: 1, totalPriceJpy: 0, customerName: '直接挿入2',
          items: { create: { tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId, startAt: t2s, endAt: t2e, serviceEndAt: t2e, active: true } },
        },
      }),
    ).rejects.toThrow(/booking_items_no_staff_overlap|exclusion|23P01/);
  });
});
