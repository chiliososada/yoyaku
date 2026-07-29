/**
 * 認証コンテキスト（権限/スコープ）を DB から組み立てる。
 * Credentials の authorize（Node 実行）でのみ使用。middleware(Edge) からは呼ばない。
 */
import { prisma } from '@/lib/db';
import { ALL_PERMISSIONS } from '@/lib/rbac';
import type { AuthContext } from './types';

/** email + パスワードで認証し、成功すれば AuthContext を返す。失敗は null。 */
export async function authenticateUser(
  email: string,
  password: string,
  verify: (plain: string, hash: string) => boolean,
): Promise<(AuthContext & { name: string; email: string }) | null> {
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, email: true, name: true, passwordHash: true, tenantId: true, isPlatformAdmin: true },
  });
  if (!user || !user.passwordHash) return null;
  if (!verify(password, user.passwordHash)) return null;

  const ctx = await buildAuthContext(user.id);
  if (!ctx) return null;

  // 最終ログイン時刻を更新（await しないが副作用として記録）
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});

  return { ...ctx, name: user.name, email: user.email };
}

/** 認証済み userId からセッションユーザー情報を構築（ポリシー認証後に使用）。 */
export async function buildSessionUserById(
  userId: string,
): Promise<(AuthContext & { name: string; email: string }) | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, email: true, name: true },
  });
  if (!user) return null;
  const ctx = await buildAuthContext(userId);
  if (!ctx) return null;
  return { ...ctx, name: user.name, email: user.email };
}

/** userId から権限集合・スコープを構築。 */
export async function buildAuthContext(userId: string): Promise<AuthContext | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      tenantId: true,
      isPlatformAdmin: true,
      sessionEpoch: true,
      memberships: {
        select: {
          shopId: true,
          role: {
            select: { scope: true, rolePermissions: { select: { permission: { select: { code: true } } } } },
          },
        },
      },
    },
  });
  if (!user) return null;

  const permissions = new Set<string>();
  const shopScopes = new Set<string>();
  let tenantWide = false;

  for (const m of user.memberships) {
    for (const rp of m.role.rolePermissions) permissions.add(rp.permission.code);
    if (m.shopId) {
      shopScopes.add(m.shopId);
    } else {
      // 店舗未指定のメンバーシップ = テナント全体（オーナー/テナント管理）
      if (m.role.scope === 'TENANT' || m.role.scope === 'PLATFORM') tenantWide = true;
    }
  }

  // プラットフォーム管理者は全権限
  if (user.isPlatformAdmin) {
    for (const p of ALL_PERMISSIONS) permissions.add(p);
    tenantWide = true;
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    isPlatformAdmin: user.isPlatformAdmin,
    permissions: [...permissions],
    shopScopes: [...shopScopes],
    tenantWide,
    sessionEpoch: user.sessionEpoch,
  };
}
