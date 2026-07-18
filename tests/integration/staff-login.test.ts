/**
 * 店員ログイン統合テスト（実DB）。
 * オーナーがスタッフにアカウント（メール+パスワード）を発行 → ログイン時の権限/スコープ、
 * 無効化、パスワード更新（再発行）、メール重複拒否を検証する。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { setStaffLogin, disableStaffLogin } from '@/server/services/merchant-mutation-service';
import { authenticateUser } from '@/server/auth/session-loader';
import { PERMISSIONS } from '@/lib/rbac';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const verify = (plain: string, hash: string) => bcrypt.compareSync(plain, hash);
const createdTenants: string[] = [];

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
  await prisma.$disconnect();
});

async function shopStaffRoleId(): Promise<string> {
  const role = await prisma.role.findFirst({ where: { code: 'SHOP_STAFF', tenantId: null }, select: { id: true } });
  if (!role) throw new Error('SHOP_STAFF role not seeded — run db:seed');
  return role.id;
}

describe('店員ログイン', () => {
  it('アカウント発行 → User作成/紐付け/Membership付与、ログインで受限権限のみ得る', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const staffId = sc.staffIds[0]!;
    const email = `staff_${Date.now()}@example.com`;

    const res = await setStaffLogin(sc.tenantId, sc.shopId, staffId, email, 'staffpass123');
    expect(res.email).toBe(email);

    // User 作成 + Staff への紐付け
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { userId: true } });
    expect(staff?.userId).toBe(res.userId);
    const user = await prisma.user.findUnique({
      where: { id: res.userId },
      select: { email: true, status: true, tenantId: true, passwordHash: true },
    });
    expect(user?.email).toBe(email);
    expect(user?.status).toBe('ACTIVE');
    expect(user?.tenantId).toBe(sc.tenantId);
    expect(verify('staffpass123', user!.passwordHash!)).toBe(true);

    // 当該店舗の SHOP_STAFF Membership
    const roleId = await shopStaffRoleId();
    const mem = await prisma.membership.findFirst({ where: { userId: res.userId, roleId, shopId: sc.shopId } });
    expect(mem).not.toBeNull();

    // ログイン → 権限/スコープ
    const ctx = await authenticateUser(email, 'staffpass123', verify);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantWide).toBe(false);
    expect(ctx!.shopScopes).toEqual([sc.shopId]);
    // 受限後台で必要な閲覧・予約操作は持つ
    expect(ctx!.permissions).toContain(PERMISSIONS.BOOKING_UPDATE);
    expect(ctx!.permissions).toContain(PERMISSIONS.CUSTOMER_READ);
    expect(ctx!.permissions).toContain(PERMISSIONS.SCHEDULE_READ);
    // オーナー/店長専用の権限は持たない
    expect(ctx!.permissions).not.toContain(PERMISSIONS.STAFF_WRITE);
    expect(ctx!.permissions).not.toContain(PERMISSIONS.ANALYTICS_READ);
    expect(ctx!.permissions).not.toContain(PERMISSIONS.SCHEDULE_WRITE);
    expect(ctx!.permissions).not.toContain(PERMISSIONS.SHOP_UPDATE);
  });

  it('無効化でログイン不可 → 再発行で復活（パスワード更新・Membership重複なし）', async () => {
    const sc = await seedScenario({ staffCount: 1 });
    createdTenants.push(sc.tenantId);
    const staffId = sc.staffIds[0]!;
    const email = `staff2_${Date.now()}@example.com`;

    const first = await setStaffLogin(sc.tenantId, sc.shopId, staffId, email, 'firstpass123');
    expect(await authenticateUser(email, 'firstpass123', verify)).not.toBeNull();

    await disableStaffLogin(sc.tenantId, sc.shopId, staffId);
    expect(await authenticateUser(email, 'firstpass123', verify)).toBeNull();

    // 再発行：同一 User を ACTIVE 化 + 新パスワード
    const second = await setStaffLogin(sc.tenantId, sc.shopId, staffId, email, 'secondpass456');
    expect(second.userId).toBe(first.userId);
    expect(await authenticateUser(email, 'firstpass123', verify)).toBeNull(); // 旧パス無効
    expect(await authenticateUser(email, 'secondpass456', verify)).not.toBeNull(); // 新パス有効

    const roleId = await shopStaffRoleId();
    const memCount = await prisma.membership.count({ where: { userId: second.userId, roleId, shopId: sc.shopId } });
    expect(memCount).toBe(1);
  });

  it('他ユーザーが使用中のメールは拒否（CONFLICT）', async () => {
    const sc = await seedScenario({ staffCount: 2 });
    createdTenants.push(sc.tenantId);
    const email = `dupe_${Date.now()}@example.com`;

    await setStaffLogin(sc.tenantId, sc.shopId, sc.staffIds[0]!, email, 'passone123');
    await expect(setStaffLogin(sc.tenantId, sc.shopId, sc.staffIds[1]!, email, 'passtwo123')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
