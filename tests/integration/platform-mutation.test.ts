/**
 * プラットフォーム書込サービスの統合テスト（実DB）。
 * 商家作成（テナント+店舗+オーナー+既定設定）・重複検出・ユーザー状態・プラン編集。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import * as svc from '@/server/services/platform-mutation-service';
import { buildAuthContext } from '@/server/auth/session-loader';
import { cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
let suffix = 0;
const uniq = () => `pm${Date.now()}${suffix++}`;

beforeAll(async () => { await prisma.$queryRaw`SELECT 1`; });
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

function tenantInput() {
  const u = uniq();
  return {
    tenantName: `テスト商家${u}`, tenantSlug: `t-${u}`,
    shopName: '本店', shopSlug: `s-${u}`,
    ownerName: 'オーナー', ownerEmail: `owner-${u}@test.com`, ownerPassword: 'password123',
    planCode: 'STANDARD',
  };
}

describe('商家作成', () => {
  it('テナント+店舗+オーナー+既定設定を一括作成し、オーナーはTENANT_OWNER権限を持つ', async () => {
    const input = tenantInput();
    const res = await svc.createTenant(input);
    createdTenants.push(res.tenantId);

    const shop = await prisma.shop.findUnique({ where: { id: res.shopId }, select: { slug: true, status: true } });
    expect(shop?.slug).toBe(input.shopSlug);
    expect(shop?.status).toBe('DRAFT');

    expect(await prisma.businessHours.count({ where: { shopId: res.shopId } })).toBe(6);
    expect(await prisma.bookingCapacityRule.count({ where: { shopId: res.shopId, scope: 'SHOP' } })).toBe(1);

    // オーナー認証コンテキスト
    const owner = await prisma.user.findUnique({ where: { id: res.ownerId }, select: { passwordHash: true } });
    expect(bcrypt.compareSync('password123', owner!.passwordHash!)).toBe(true);
    const ctx = await buildAuthContext(res.ownerId);
    expect(ctx?.tenantWide).toBe(true);
    expect(ctx?.permissions).toContain('booking:create');
    expect(ctx?.permissions).toContain('shop:update');
  });

  it('重複slug/メールは拒否', async () => {
    const input = tenantInput();
    const res = await svc.createTenant(input);
    createdTenants.push(res.tenantId);
    // 同じ tenantSlug
    await expect(svc.createTenant(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('ユーザー状態 / プラン編集', () => {
  it('ユーザーを停止できるが、プラットフォーム管理者は不可', async () => {
    const input = tenantInput();
    const res = await svc.createTenant(input);
    createdTenants.push(res.tenantId);
    await svc.setUserStatus(res.ownerId, 'SUSPENDED');
    const u = await prisma.user.findUnique({ where: { id: res.ownerId }, select: { status: true } });
    expect(u?.status).toBe('SUSPENDED');

    const admin = await prisma.user.findFirst({ where: { isPlatformAdmin: true }, select: { id: true } });
    if (admin) {
      await expect(svc.setUserStatus(admin.id, 'SUSPENDED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('プランを編集できる', async () => {
    const plan = await prisma.plan.findFirst({ where: { code: 'FREE' }, select: { id: true, name: true } });
    if (!plan) return;
    await svc.updatePlan(plan.id, { name: plan.name, priceJpy: 500, maxShops: 2, maxStaffPerShop: 5, maxBookingsPerMonth: 200, isActive: true });
    const updated = await prisma.plan.findUnique({ where: { id: plan.id }, select: { priceJpy: true } });
    expect(updated?.priceJpy).toBe(500);
    // 元に戻す
    await svc.updatePlan(plan.id, { name: plan.name, priceJpy: 0, maxShops: 1, maxStaffPerShop: 3, maxBookingsPerMonth: 100, isActive: true });
  });
});
