/**
 * 認証ミドルウェア（Edge）。/admin /platform を未ログインから保護し、
 * /admin 配下のオーナー専用ページをスタッフ(SHOP_STAFF)の URL 直打ちから守る。
 * 細かい権限判定（テナント越境等）は各レイアウト/アクション(Node)で行う。
 */
import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/server/auth/auth.config';
import { PERMISSIONS, type Permission } from '@/lib/rbac';

const { auth } = NextAuth(authConfig);

/**
 * オーナー/店長専用ページ → 必要権限。SHOP_STAFF はこれらの権限を持たないため弾かれる。
 * より具体的なパス（/admin/customers/dormant）を先に並べる。
 */
const OWNER_ONLY: ReadonlyArray<readonly [string, Permission]> = [
  ['/admin/settings', PERMISSIONS.SHOP_UPDATE],
  ['/admin/homepage', PERMISSIONS.SHOP_UPDATE],
  ['/admin/qr', PERMISSIONS.SHOP_UPDATE],
  ['/admin/notifications', PERMISSIONS.SHOP_UPDATE],
  ['/admin/staff', PERMISSIONS.STAFF_WRITE],
  ['/admin/services', PERMISSIONS.SERVICE_WRITE],
  ['/admin/business-hours', PERMISSIONS.SCHEDULE_WRITE],
  ['/admin/rules', PERMISSIONS.SCHEDULE_WRITE],
  ['/admin/calendar', PERMISSIONS.SCHEDULE_WRITE],
  ['/admin/reports', PERMISSIONS.ANALYTICS_READ],
  ['/admin/export', PERMISSIONS.ANALYTICS_READ],
  ['/admin/customers/dormant', PERMISSIONS.ANALYTICS_READ],
  ['/admin/logs', PERMISSIONS.AUDIT_READ],
  ['/admin/shops', PERMISSIONS.SHOP_CREATE],
];

/** スタッフの既定ホーム（自分のスケジュール）。 */
const STAFF_HOME = '/admin/schedule';

function matchesPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

/** 固定長比較（タイミング攻撃対策の簡易実装。Edge 互換のため crypto 非依存）。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * /platform（運営後台）の第二層防御（割賦販売法チェックリスト「IP制限またはベーシック認証」対応）。
 * - PLATFORM_IP_ALLOWLIST（カンマ区切り）設定時: 許可外 IP を 403
 * - PLATFORM_BASIC_USER/PASS 設定時: Basic 認証を要求（パスワードログインとは別層）
 * どちらも未設定なら従来どおり（休眠）。
 */
function platformSecondLayer(req: { headers: Headers }): NextResponse | null {
  const allowlist = process.env.PLATFORM_IP_ALLOWLIST;
  if (allowlist) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      '';
    const allowed = allowlist.split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.includes(ip)) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }
  const basicUser = process.env.PLATFORM_BASIC_USER;
  const basicPass = process.env.PLATFORM_BASIC_PASS;
  if (basicUser && basicPass) {
    const header = req.headers.get('authorization') ?? '';
    let ok = false;
    if (header.startsWith('Basic ')) {
      try {
        const [u, ...rest] = atob(header.slice(6)).split(':');
        ok = safeEqual(u ?? '', basicUser) && safeEqual(rest.join(':'), basicPass);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      return new NextResponse('Authentication required', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="platform", charset="UTF-8"' },
      });
    }
  }
  return null;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;
  const isAdmin = pathname.startsWith('/admin');
  const isProtected = isAdmin || pathname.startsWith('/platform');

  // 運営後台はセッション認証の前段に IP/Basic の第二層を挟む
  if (pathname.startsWith('/platform')) {
    const blocked = platformSecondLayer(req);
    if (blocked) return blocked;
  }

  if (isProtected && !user) {
    const url = new URL('/login', req.nextUrl.origin);
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }

  // /admin 配下：スタッフ権限ガード（プラットフォーム管理者は全権のため素通り）
  if (isAdmin && user && !user.isPlatformAdmin) {
    const perms = user.permissions ?? [];

    // ダッシュボードは経営指標。閲覧権限(analytics)が無いスタッフは自分のスケジュールへ。
    if ((pathname === '/admin' || pathname === '/admin/') && !perms.includes(PERMISSIONS.ANALYTICS_READ)) {
      return NextResponse.redirect(new URL(STAFF_HOME, req.nextUrl.origin));
    }

    const guard = OWNER_ONLY.find(([prefix]) => matchesPath(pathname, prefix));
    if (guard && !perms.includes(guard[1])) {
      return NextResponse.redirect(new URL(STAFF_HOME, req.nextUrl.origin));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/admin/:path*', '/platform/:path*'],
};
