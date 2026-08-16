/**
 * 複数店舗（createShop）の統合テスト: プラン上限 / slug一意 / 既定設定生成。
 */
import crypto from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import * as svc from '@/server/services/merchant-mutation-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const tenants: string[] = [];
const planIds: string[] = [];
afterAll(async () => {
  for (const t of tenants) await cleanupTenant(t);
  if (planIds.length) await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
});

describe('createShop（複数店舗）', () => {
  it('プラン上限で拒否 → 上限拡大で作成でき既定設定も生成 → slug重複は拒否', async () => {
    const sc = await seedScenario({ staffCount: 1 }); // 既に1店舗、プランなし=上限1
    tenants.push(sc.tenantId);
    const u = crypto.randomUUID().slice(0, 8);

    // 上限1に達しているので追加拒否
    await expect(
      svc.createShop(sc.tenantId, { name: '2号店', slug: `shop2-${u}`, timezone: 'Asia/Tokyo' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    // プランを maxShops=3 にして紐付け
    const plan = await prisma.plan.create({ data: { code: `test-plan-${u}`, name: 'Testプラン', maxShops: 3 } });
    planIds.push(plan.id);
    await prisma.tenant.update({ where: { id: sc.tenantId }, data: { planId: plan.id } });

    const shop = await svc.createShop(sc.tenantId, { name: '2号店', slug: `shop2-${u}`, timezone: 'Asia/Tokyo' });
    expect(shop.status).toBe('DRAFT');
    expect(shop.tenantId).toBe(sc.tenantId);
    // 既定の営業時間(月〜土=6)と容量ルール(1)が生成される
    expect(await prisma.businessHours.count({ where: { shopId: shop.id } })).toBe(6);
    expect(await prisma.bookingCapacityRule.count({ where: { shopId: shop.id } })).toBe(1);

    // slug はグローバル一意 → 同 slug は拒否
    await expect(
      svc.createShop(sc.tenantId, { name: '重複', slug: `shop2-${u}`, timezone: 'Asia/Tokyo' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('別テナントの店舗数は互いに影響しない（テナント隔離）', async () => {
    const a = await seedScenario({ staffCount: 1 });
    const b = await seedScenario({ staffCount: 1 });
    tenants.push(a.tenantId, b.tenantId);
    const u = crypto.randomUUID().slice(0, 8);
    const plan = await prisma.plan.create({ data: { code: `iso-plan-${u}`, name: 'iso', maxShops: 2 } });
    planIds.push(plan.id);
    await prisma.tenant.update({ where: { id: a.tenantId }, data: { planId: plan.id } });

    // A は上限2・1店舗なので1つ追加できる
    const shop = await svc.createShop(a.tenantId, { name: 'A2', slug: `a2-${u}`, timezone: 'Asia/Tokyo' });
    const aCount = await prisma.shop.count({ where: { tenantId: a.tenantId, deletedAt: null } });
    const bCount = await prisma.shop.count({ where: { tenantId: b.tenantId, deletedAt: null } });
    expect(shop.tenantId).toBe(a.tenantId);
    expect(aCount).toBe(2);
    expect(bCount).toBe(1); // B は影響なし
  });
});

/**
 * 「店舗同時受付上限」は店舗設定と予約ルールの2画面にあるが、実際に効くのは
 * SHOP スコープの容量ルールだけだった。店主が席を増やしても保存はできるのに
 * 1件しか入らず、原因が分からない（保存成功の表示だけが出る）。
 */
describe('店舗設定の同時受付上限が実際に効く', () => {
  it('設定を3に変えると SHOP 容量ルールも3になり、空き枠の残数に反映される', async () => {
    const { getDayAvailability } = await import('@/server/services/booking-service');
    const sc = await seedScenario({ staffCount: 3, staffCapacity: 1, shopCapacity: 1 });
    tenants.push(sc.tenantId);

    const before = await prisma.bookingCapacityRule.findFirstOrThrow({
      where: { shopId: sc.shopId, scope: 'SHOP' },
      select: { maxConcurrent: true },
    });
    expect(before.maxConcurrent).toBe(1);

    await svc.updateShopSettings(sc.tenantId, sc.shopId, {
      slug: sc.shopSlug,
      name: 'テスト店', description: '', phone: '', email: '',
      postalCode: '', prefecture: '', city: '', address: '',
      status: 'PUBLISHED', publicBookingEnabled: true, closeOnNationalHolidays: false,
      shopCapacity: 3,
    });

    // 予約ルール側（唯一の正）が更新されている
    const after = await prisma.bookingCapacityRule.findFirstOrThrow({
      where: { shopId: sc.shopId, scope: 'SHOP' },
      select: { maxConcurrent: true },
    });
    expect(after.maxConcurrent).toBe(3);

    // 実際の空き計算にも効く（残数が3人ぶん出る）
    const { slots } = await getDayAvailability({
      tenantId: sc.tenantId, shopId: sc.shopId, serviceId: sc.serviceId,
      date: '2026-09-07', now: new Date('2026-09-01T00:00:00Z'),
    });
    const open = slots.filter((s) => s.available);
    expect(open.length).toBeGreaterThan(0);
    expect(Math.max(...open.map((s) => s.remaining))).toBeGreaterThan(1);
  });
});
