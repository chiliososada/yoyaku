/**
 * RBAC 境界テスト: server action が権限/スコープ不足を確実に拒否することを検証。
 * auth() をモックしてセッションを制御し、実 service/DB に対して allow/deny を確認する。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// next/cache の revalidatePath は Next ランタイム外で動かないためモック
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// auth 本体（NextAuth/Prisma 依存）を避け、セッションを制御
vi.mock('@/server/auth/auth', () => ({
  auth: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

import { auth } from '@/server/auth/auth';
import { prisma } from '@/lib/db';
import { PERMISSIONS } from '@/lib/rbac';
import { updateShopSettingsAction } from '@/server/actions/admin-actions';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const mockAuth = vi.mocked(auth);
const createdTenants: string[] = [];
let tenantId = '';
let shopId = '';
let userId = '';

function sessionFor(over: Partial<{
  tenantId: string | null;
  isPlatformAdmin: boolean;
  permissions: string[];
  shopScopes: string[];
  tenantWide: boolean;
}>) {
  return {
    user: {
      id: userId,
      name: 'Tester',
      email: 't@test.com',
      tenantId: over.tenantId ?? tenantId,
      isPlatformAdmin: over.isPlatformAdmin ?? false,
      permissions: over.permissions ?? [],
      shopScopes: over.shopScopes ?? [],
      tenantWide: over.tenantWide ?? false,
    },
    expires: '2099-01-01',
  } as never;
}

const validInput = () => ({
  name: '更新テスト店舗', description: '', phone: '', email: '', postalCode: '', prefecture: '', city: '', address: '',
  status: 'PUBLISHED' as const, publicBookingEnabled: true, closeOnNationalHolidays: true, shopCapacity: 2,
});

beforeAll(async () => {
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  tenantId = sc.tenantId;
  shopId = sc.shopId;
  const u = await prisma.user.create({
    data: { email: `rbac-${Date.now()}@test.com`, name: 'RBAC Tester', tenantId, status: 'ACTIVE' },
    select: { id: true },
  });
  userId = u.id;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});
beforeEach(() => mockAuth.mockReset());

describe('RBAC: updateShopSettingsAction', () => {
  it('未ログインは拒否（UNAUTHORIZED）', async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await updateShopSettingsAction(shopId, validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNAUTHORIZED');
  });

  it('SHOP_UPDATE 権限なしは拒否（FORBIDDEN）', async () => {
    mockAuth.mockResolvedValue(sessionFor({ permissions: [PERMISSIONS.SHOP_READ], tenantWide: true }));
    const res = await updateShopSettingsAction(shopId, validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FORBIDDEN');
  });

  it('権限はあるが店舗スコープ外は拒否（FORBIDDEN）', async () => {
    mockAuth.mockResolvedValue(sessionFor({ permissions: [PERMISSIONS.SHOP_UPDATE], tenantWide: false, shopScopes: ['other-shop'] }));
    const res = await updateShopSettingsAction(shopId, validInput());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('FORBIDDEN');
  });

  it('別テナントのユーザーは拒否（FORBIDDEN）', async () => {
    mockAuth.mockResolvedValue(sessionFor({ tenantId: 'other-tenant', permissions: [PERMISSIONS.SHOP_UPDATE], tenantWide: true }));
    const res = await updateShopSettingsAction(shopId, validInput());
    expect(res.ok).toBe(false); // assertShopAccess は tenantWide で通るが、service の所有権検証で NOT_FOUND
  });

  it('権限 + テナント全体スコープ + 自テナントなら成功し、DBが更新される', async () => {
    mockAuth.mockResolvedValue(sessionFor({ permissions: [PERMISSIONS.SHOP_UPDATE], tenantWide: true }));
    const res = await updateShopSettingsAction(shopId, validInput());
    expect(res.ok).toBe(true);
    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { name: true } });
    expect(shop?.name).toBe('更新テスト店舗');
  });
});
