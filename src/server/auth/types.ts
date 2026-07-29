/**
 * セッション/JWT の型拡張。
 * permissions は権限コードの集合。tenantWide はテナント全体権限（店長以上）か。
 * shopScopes は店舗スコープのロールで許可された shopId 群。
 */
import type { DefaultSession } from 'next-auth';

export interface AuthContext {
  id: string;
  tenantId: string | null;
  isPlatformAdmin: boolean;
  permissions: string[];
  shopScopes: string[];
  tenantWide: boolean;
  /// セッション世代（DB の users.sessionEpoch）。失効判定に使う。
  sessionEpoch: number;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      tenantId: string | null;
      isPlatformAdmin: boolean;
      permissions: string[];
      shopScopes: string[];
      tenantWide: boolean;
      sessionEpoch: number;
    } & DefaultSession['user'];
  }

  interface User {
    tenantId?: string | null;
    isPlatformAdmin?: boolean;
    permissions?: string[];
    shopScopes?: string[];
    tenantWide?: boolean;
    sessionEpoch?: number;
  }
}
