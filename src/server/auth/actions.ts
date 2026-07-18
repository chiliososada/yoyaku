'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { signOut } from './auth';
import { getSessionUser, canAccessShop } from './authorize';
import { prisma } from '@/lib/db';
import { SELECTED_SHOP_COOKIE } from '@/server/services/merchant-service';

export async function logoutAction() {
  await signOut({ redirectTo: '/login' });
}

/** 対象店舗を切り替える（当テナントの店舗のみ）。全管理画面が追従する。 */
export async function selectShopAction(shopId: string) {
  const user = await getSessionUser();
  if (!user?.tenantId) return;
  // スコープ外の店舗には切り替えさせない（受限スタッフ/店長の店舗越境を防止）。
  if (!canAccessShop(user, shopId)) return;
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, tenantId: user.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!shop) return;
  cookies().set(SELECTED_SHOP_COOKIE, shopId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/admin', 'layout');
}
