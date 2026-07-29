/**
 * サーバー側の認可ヘルパー。server components / server actions で使用。
 * - requireXxx: ページ用（未認可は redirect / throw）
 * - hasPermission / canAccessShop: 判定用
 */
import { redirect } from 'next/navigation';
import { auth } from './auth';
import { Errors } from '@/lib/errors';
import type { Permission } from '@/lib/rbac';
import type { Session } from 'next-auth';

export type SessionUser = NonNullable<Session['user']>;

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user ?? null;
  if (!user) return null;
  // JWT はサーバー側に状態を持たないため、停止・無効化・パスワードリセットを
  // 即時反映するには毎リクエストで DB と照合する必要がある（Node 実行のここが全入口の合流点）。
  // status が ACTIVE でない／論理削除済み／sessionEpoch 不一致なら失効扱い（= 未ログイン）。
  try {
    const { prisma } = await import('@/lib/db');
    const fresh = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true, deletedAt: true, sessionEpoch: true },
    });
    if (!fresh || fresh.status !== 'ACTIVE' || fresh.deletedAt) return null;
    // 既存トークン（この機能導入前に発行）は sessionEpoch を持たない → 0 とみなし DB(既定0)と一致
    if ((user.sessionEpoch ?? 0) !== fresh.sessionEpoch) return null;
  } catch {
    // リクエストコンテキスト外（worker/test 等）では照合不能。ここに来る経路は
    // 認証を要求しないため、トークンをそのまま返す（既存挙動を壊さない）。
    return user;
  }
  return user;
}

/** ログイン必須（ページ用）。未ログインは /login へ。 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** テナント所属ユーザー必須（商家後台用）。 */
export async function requireTenantUser(
  opts?: { skipBillingGate?: boolean },
): Promise<SessionUser & { tenantId: string }> {
  const user = await requireUser();
  if (!user.tenantId && !user.isPlatformAdmin) redirect('/login');
  // プラットフォーム管理者は tenantId を持たないことがある（商家後台では非対象）
  if (!user.tenantId) redirect('/platform');
  // 課金ゲート: トライアル終了かつ未契約のテナントは契約ページへ誘導。
  // /admin/billing 自身は skipBillingGate で除外（無限リダイレクト防止）。
  // Stripe 未設定時は loadBillingGate が常に許可（休眠）。
  if (!opts?.skipBillingGate) {
    const { loadBillingGate } = await import('@/server/billing/billing-service');
    const gate = await loadBillingGate(user.tenantId);
    if (!gate.allowed) redirect('/admin/billing');
  }
  return user as SessionUser & { tenantId: string };
}

/** プラットフォーム管理者必須。 */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) redirect('/admin');
  return user;
}

export function hasPermission(user: SessionUser, permission: Permission): boolean {
  return user.isPlatformAdmin || user.permissions.includes(permission);
}

/** 権限必須（action 用、未認可は ForbiddenError を throw）。 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw Errors.unauthorized();
  if (!hasPermission(user, permission)) throw Errors.forbidden();
  return user;
}

/** 店舗アクセス可否（テナント全体権限 or 当該店舗スコープ）。 */
export function canAccessShop(user: SessionUser, shopId: string): boolean {
  return user.isPlatformAdmin || user.tenantWide || user.shopScopes.includes(shopId);
}

/** 店舗アクセス必須（action 用）。 */
export function assertShopAccess(user: SessionUser, shopId: string): void {
  if (!canAccessShop(user, shopId)) throw Errors.forbidden('この店舗を操作する権限がありません。');
}
