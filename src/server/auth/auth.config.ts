/**
 * Edge セーフな Auth.js 基本設定（DB 非依存）。middleware から使う。
 * 認証本体（Credentials + DB）は auth.ts 側で providers を足す。
 * jwt/session コールバックは token の詰め替えのみ（DB アクセスなし）。
 */
import type { NextAuthConfig } from 'next-auth';
import './types';

export const authConfig = {
  trustHost: true,
  // 30日は長すぎる。失効不能の JWT を短くして被害窓を縮める（サーバー側失効は
  // getSessionUser の sessionEpoch 照合が担保する。これは多層防御）。
  session: { strategy: 'jwt', maxAge: 7 * 24 * 60 * 60 },
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
        token.sessionEpoch = user.sessionEpoch ?? 0;
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
          sessionEpoch?: number;
        };
        session.user.id = t.userId;
        session.user.tenantId = t.tenantId ?? null;
        session.user.isPlatformAdmin = t.isPlatformAdmin ?? false;
        session.user.permissions = t.permissions ?? [];
        session.user.shopScopes = t.shopScopes ?? [];
        session.user.tenantWide = t.tenantWide ?? false;
        session.user.sessionEpoch = t.sessionEpoch ?? 0;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
