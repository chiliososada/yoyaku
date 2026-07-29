/**
 * 予約クォータ×冪等の相互作用（FIX-B #2）の統合テスト（実DB）。
 *
 * 検証する不変条件:
 *  - 月間予約上限は createBooking 内で source==='PUBLIC' のときだけ効く（ADMIN/取込は素通り）
 *  - 冪等リプレイ（同一 idempotencyKey の再送）は上限判定より前に返る
 *    → 既に作成済みの予約を「新規1件」と誤カウントして正当なリトライを弾かない
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createBooking, getDayAvailability } from '@/server/services/booking-service';
import { zonedDateString, addMin } from '@/lib/time';
import { isAppError } from '@/lib/errors';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
const createdPlans: string[] = [];
const NOW = new Date(); // 実時刻。createdAt ベースのクォータ集計月と一致させる。
const DATE = zonedDateString(addMin(NOW, 5 * 24 * 60), 'Asia/Tokyo'); // 5日後（window内・lead OK）

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.plan.deleteMany({ where: { id: { in: createdPlans } } });
});

/** maxBookingsPerMonth=limit の従量プランを当てた課金対象テナントを用意。 */
async function seedCappedTenant(limit: number) {
  const sc = await seedScenario({ staffCount: 1, staffCapacity: 1 });
  createdTenants.push(sc.tenantId);
  const plan = await prisma.plan.create({
    data: { code: `gate-${sc.tenantId.slice(-8)}`, name: 'ゲート検証', priceJpy: 9800, maxBookingsPerMonth: limit },
  });
  createdPlans.push(plan.id);
  await prisma.tenant.update({ where: { id: sc.tenantId }, data: { planId: plan.id, billingExempt: false } });
  return sc;
}

/** 当月 createdAt の予約行を n 件直接投入（startAt は遠未来＝当日枠を占有しない）。 */
async function fillMonth(sc: { tenantId: string; shopId: string; serviceId: string }, n: number) {
  const customer = await prisma.customer.create({
    data: { tenantId: sc.tenantId, shopId: sc.shopId, name: 'gate', email: `g${Date.now()}@t.test` },
  });
  const base = new Date('2099-01-01T00:00:00Z').getTime();
  await prisma.booking.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      tenantId: sc.tenantId,
      shopId: sc.shopId,
      customerId: customer.id,
      serviceId: sc.serviceId,
      startAt: new Date(base + i * 3600_000),
      endAt: new Date(base + i * 3600_000 + 1800_000),
      status: 'CONFIRMED' as const,
      totalPriceJpy: 1000,
      customerName: 'gate',
    })),
  });
}

async function firstSlot(sc: { tenantId: string; shopId: string; serviceId: string }) {
  const { slots } = await getDayAvailability({
    tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, date: DATE, now: NOW,
  });
  const slot = slots.find((s) => s.available);
  expect(slot).toBeTruthy();
  return slot!;
}

describe('createBooking の月間クォータ適用', () => {
  it('PUBLIC は上限超過（猶予も超過）で拒否、ADMIN は素通り', async () => {
    const sc = await seedCappedTenant(1);
    await fillMonth(sc, 1); // used=1 = limit=1 → 猶予も超過

    const slot = await firstSlot(sc);

    // オンライン予約はブロック（顧客文面。課金事情は出さない）
    try {
      await createBooking({
        tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
        startAt: slot.startAt, customer: { name: 'PUB', email: 'pub@test.com' },
        source: 'PUBLIC', now: NOW,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as { userMessage: string }).userMessage).toContain('店舗へ直接');
    }

    // 後台（ADMIN）は常に登録できる＝店舗の営業を止めない
    const admin = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'ADM', email: 'adm@test.com' },
      source: 'ADMIN', now: NOW,
    });
    expect(admin.status).toBe('CONFIRMED');
  });

  it('冪等リプレイは上限直下でも弾かれず既存予約を返す（新規キーは拒否）', async () => {
    const sc = await seedCappedTenant(1);
    const slot = await firstSlot(sc);

    // 上限枠内(used=0)で1件目を作成（idempotencyKey 付き）→ used=1
    const first = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'K1', email: 'k1@test.com' },
      source: 'PUBLIC', idempotencyKey: 'gate-key-1', now: NOW,
    });
    expect(first.status).toBe('CONFIRMED');

    // 同一キーの再送（ネットワークリトライ）→ used=1=limit を超えていても、
    // リプレイはクォータ判定より前に返るので拒否されない
    const replay = await createBooking({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
      startAt: slot.startAt, customer: { name: 'K1', email: 'k1@test.com' },
      source: 'PUBLIC', idempotencyKey: 'gate-key-1', now: NOW,
    });
    expect(replay.id).toBe(first.id);
    expect(replay.idempotentReplay).toBe(true);

    // 別キーの新規予約は上限超過で拒否される（リプレイのみが特例であることの確認）
    await expect(
      createBooking({
        tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId, staffId: null,
        startAt: slot.startAt, customer: { name: 'K2', email: 'k2@test.com' },
        source: 'PUBLIC', idempotencyKey: 'gate-key-2', now: NOW,
      }),
    ).rejects.toThrow();
  });
});
