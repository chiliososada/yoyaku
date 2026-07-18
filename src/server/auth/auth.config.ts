/**
 * Edge セーフな Auth.js 基本設定（DB 非依存）。middleware から使う。
 * 認証本体（Credentials + DB）は auth.ts 側で providers を足す。
 * jwt/session コールバックは token の詰め替えのみ（DB アクセスなし）。
 */
import type { NextAuthConfig } from 'next-auth';
import './types';

export const authConfig = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id as string;
        token.tenantId = user.tenantId ?? null;
        token.isPlatformAdmin = user.isPlatformAdmin ?? false;
        token.permissions = user.permissions ?? [];
        token.shopScopes = user.shopScopes ?? [];
        token.tenantWide = user.tenantWide ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        const t = token as unknown as {
          userId: string;
          tenantId: string | null;
          isPlatformAdmin: boolean;
          permissions: string[];
          shopScopes: string[];
          tenantWide: boolean;
        };
        session.user.id = t.userId;
        session.user.tenantId = t.tenantId ?? null;
        session.user.isPlatformAdmin = t.isPlatformAdmin ?? false;
        session.user.permissions = t.permissions ?? [];
        session.user.shopScopes = t.shopScopes ?? [];
        session.user.tenantWide = t.tenantWide ?? false;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
