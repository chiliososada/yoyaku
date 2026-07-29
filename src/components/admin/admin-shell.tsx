'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  BellRing,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarOff,
  CalendarRange,
  Clock,
  CreditCard,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  QrCode,
  ScrollText,
  Scissors,
  Settings,
  SlidersHorizontal,
  Store,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PERMISSIONS } from '@/lib/rbac';
import { logoutAction } from '@/server/auth/actions';
import { ShopSwitcher } from './shop-switcher';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** この権限を持つユーザーだけに表示。未指定なら全員に表示（スタッフも閲覧可）。 */
  perm?: string;
}

const MERCHANT_NAV: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard, perm: PERMISSIONS.ANALYTICS_READ },
  { href: '/admin/bookings', label: '予約', icon: CalendarCheck },
  { href: '/admin/schedule', label: 'スケジュール', icon: CalendarRange },
  { href: '/admin/reports', label: 'レポート', icon: BarChart3, perm: PERMISSIONS.ANALYTICS_READ },
  { href: '/admin/customers', label: '顧客', icon: Users },
  { href: '/admin/staff', label: 'スタッフ', icon: UserCog, perm: PERMISSIONS.STAFF_WRITE },
  { href: '/admin/services', label: 'メニュー', icon: Scissors, perm: PERMISSIONS.SERVICE_WRITE },
  { href: '/admin/business-hours', label: '営業時間', icon: Clock, perm: PERMISSIONS.SCHEDULE_WRITE },
  { href: '/admin/calendar', label: '休業・特別営業', icon: CalendarOff, perm: PERMISSIONS.SCHEDULE_WRITE },
  { href: '/admin/rules', label: '予約ルール', icon: SlidersHorizontal, perm: PERMISSIONS.SCHEDULE_WRITE },
  { href: '/admin/logs', label: '操作ログ', icon: ScrollText, perm: PERMISSIONS.AUDIT_READ },
  { href: '/admin/homepage', label: 'ホームページ', icon: Globe, perm: PERMISSIONS.SHOP_UPDATE },
  { href: '/admin/qr', label: '予約QR・集客', icon: QrCode, perm: PERMISSIONS.SHOP_UPDATE },
  { href: '/admin/notifications', label: '通知設定', icon: BellRing, perm: PERMISSIONS.SHOP_UPDATE },
  { href: '/admin/settings', label: '店舗設定', icon: Store, perm: PERMISSIONS.SHOP_UPDATE },
  // 課金ページは店員もリダイレクト着地しうるため middleware では守らず、操作のみ SHOP_CREATE で制御
  { href: '/admin/billing', label: '契約・お支払い', icon: CreditCard, perm: PERMISSIONS.SHOP_CREATE },
];

const PLATFORM_NAV: NavItem[] = [
  { href: '/platform', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/platform/tenants', label: '商家', icon: Building2 },
  { href: '/platform/plans', label: 'プラン', icon: Package },
  { href: '/platform/users', label: 'ユーザー', icon: Users },
  { href: '/platform/audit', label: '監査ログ', icon: ScrollText },
  { href: '/platform/settings', label: 'システム設定', icon: Settings },
];

export interface AdminShellProps {
  variant: 'merchant' | 'platform';
  brandLabel: string;
  userName: string;
  userEmail: string;
  /** セッションの権限集合。オーナー専用のナビ項目を絞り込むのに使う。 */
  permissions?: string[];
  shops?: { id: string; name: string; status: string }[];
  currentShopId?: string;
  children: React.ReactNode;
}

export function AdminShell({ variant, brandLabel, userName, userEmail, permissions, shops, currentShopId, children }: AdminShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const perms = permissions ?? [];
  const nav = (variant === 'platform' ? PLATFORM_NAV : MERCHANT_NAV).filter(
    (item) => !item.perm || perms.includes(item.perm),
  );

  const isActive = (href: string) =>
    href === `/${variant === 'platform' ? 'platform' : 'admin'}`
      ? pathname === href
      : pathname.startsWith(href);

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 transform flex-col border-r border-slate-800 bg-slate-950 text-slate-100 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-4">
          <Link href={nav[0]!.href} className="flex min-w-0 items-center gap-2.5 font-semibold">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/40">
              <CalendarCheck className="size-5" />
            </span>
            <span className="truncate text-sm">{brandLabel}</span>
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="閉じる">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-primary/15 font-medium text-white'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100',
                )}
              >
                {active && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />}
                <item.icon className={cn('size-4 shrink-0', active && 'text-primary')} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800/80 p-3">
          {variant === 'merchant' && (
            <a
              href="/guide"
              target="_blank"
              rel="noreferrer"
              className="mb-1.5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
            >
              <BookOpen className="size-4 shrink-0" /> 使い方ガイド
            </a>
          )}
          <div className="px-3 text-[11px] text-slate-500">
            {variant === 'platform' ? 'Platform Console' : 'Merchant Console'}
          </div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="メニュー">
            <Menu className="size-5" />
          </button>
          {variant === 'merchant' && shops && shops.length > 0 && currentShopId ? (
            <ShopSwitcher
              shops={shops}
              currentId={currentShopId}
              canCreateShop={perms.includes(PERMISSIONS.SHOP_CREATE)}
            />
          ) : (
            <div className="hidden lg:block" />
          )}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {userName.charAt(0)}
              </span>
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium leading-tight">{userName}</div>
                <div className="text-xs text-muted-foreground">{userEmail}</div>
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <LogOut className="size-3.5" />
                ログアウト
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
