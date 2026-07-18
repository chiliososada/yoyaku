/**
 * RBAC 定義。権限カタログとシステムロール→権限のマッピング。
 * DB の roles/permissions/role_permissions はこの定義を seed で投入する。
 * 実行時の権限判定は src/server/auth/authorize.ts が、セッションの権限集合に対して行う。
 */

export const PERMISSIONS = {
  // プラットフォーム
  PLATFORM_TENANT_MANAGE: 'platform:tenant:manage',
  PLATFORM_PLAN_MANAGE: 'platform:plan:manage',
  PLATFORM_USER_MANAGE: 'platform:user:manage',
  PLATFORM_CONFIG_MANAGE: 'platform:config:manage',
  PLATFORM_AUDIT_READ: 'platform:audit:read',

  // 店舗
  SHOP_READ: 'shop:read',
  SHOP_UPDATE: 'shop:update',
  SHOP_CREATE: 'shop:create',

  // スタッフ
  STAFF_READ: 'staff:read',
  STAFF_WRITE: 'staff:write',

  // サービス
  SERVICE_READ: 'service:read',
  SERVICE_WRITE: 'service:write',

  // 営業時間/休業/容量ルール
  SCHEDULE_READ: 'schedule:read',
  SCHEDULE_WRITE: 'schedule:write',

  // 予約
  BOOKING_READ: 'booking:read',
  BOOKING_CREATE: 'booking:create',
  BOOKING_UPDATE: 'booking:update',
  BOOKING_CANCEL: 'booking:cancel',

  // 顧客
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_WRITE: 'customer:write',

  // 分析/監査
  ANALYTICS_READ: 'analytics:read',
  AUDIT_READ: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** 権限のカテゴリ（管理画面表示用）。 */
export const PERMISSION_CATEGORY: Record<Permission, string> = {
  [PERMISSIONS.PLATFORM_TENANT_MANAGE]: 'platform',
  [PERMISSIONS.PLATFORM_PLAN_MANAGE]: 'platform',
  [PERMISSIONS.PLATFORM_USER_MANAGE]: 'platform',
  [PERMISSIONS.PLATFORM_CONFIG_MANAGE]: 'platform',
  [PERMISSIONS.PLATFORM_AUDIT_READ]: 'platform',
  [PERMISSIONS.SHOP_READ]: 'shop',
  [PERMISSIONS.SHOP_UPDATE]: 'shop',
  [PERMISSIONS.SHOP_CREATE]: 'shop',
  [PERMISSIONS.STAFF_READ]: 'staff',
  [PERMISSIONS.STAFF_WRITE]: 'staff',
  [PERMISSIONS.SERVICE_READ]: 'service',
  [PERMISSIONS.SERVICE_WRITE]: 'service',
  [PERMISSIONS.SCHEDULE_READ]: 'schedule',
  [PERMISSIONS.SCHEDULE_WRITE]: 'schedule',
  [PERMISSIONS.BOOKING_READ]: 'booking',
  [PERMISSIONS.BOOKING_CREATE]: 'booking',
  [PERMISSIONS.BOOKING_UPDATE]: 'booking',
  [PERMISSIONS.BOOKING_CANCEL]: 'booking',
  [PERMISSIONS.CUSTOMER_READ]: 'customer',
  [PERMISSIONS.CUSTOMER_WRITE]: 'customer',
  [PERMISSIONS.ANALYTICS_READ]: 'analytics',
  [PERMISSIONS.AUDIT_READ]: 'audit',
};

export type SystemRoleCode = 'PLATFORM_ADMIN' | 'TENANT_OWNER' | 'SHOP_MANAGER' | 'SHOP_STAFF';

export interface SystemRoleDef {
  code: SystemRoleCode;
  name: string;
  scope: 'PLATFORM' | 'TENANT' | 'SHOP';
  permissions: Permission[];
}

const SHOP_STAFF_PERMS: Permission[] = [
  PERMISSIONS.SHOP_READ,
  PERMISSIONS.STAFF_READ,
  PERMISSIONS.SERVICE_READ,
  PERMISSIONS.SCHEDULE_READ,
  PERMISSIONS.BOOKING_READ,
  PERMISSIONS.BOOKING_CREATE,
  PERMISSIONS.BOOKING_UPDATE,
  PERMISSIONS.BOOKING_CANCEL,
  PERMISSIONS.CUSTOMER_READ,
];

const SHOP_MANAGER_PERMS: Permission[] = [
  ...SHOP_STAFF_PERMS,
  PERMISSIONS.SHOP_UPDATE,
  PERMISSIONS.STAFF_WRITE,
  PERMISSIONS.SERVICE_WRITE,
  PERMISSIONS.SCHEDULE_WRITE,
  PERMISSIONS.CUSTOMER_WRITE,
  PERMISSIONS.ANALYTICS_READ,
];

const TENANT_OWNER_PERMS: Permission[] = [
  ...SHOP_MANAGER_PERMS,
  PERMISSIONS.SHOP_CREATE,
  PERMISSIONS.AUDIT_READ,
];

/** システム組込ロール。seed で投入。 */
export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    code: 'PLATFORM_ADMIN',
    name: 'プラットフォーム管理者',
    scope: 'PLATFORM',
    // プラットフォーム管理者は全権（実行時は isPlatformAdmin でもバイパス可）
    permissions: ALL_PERMISSIONS,
  },
  {
    code: 'TENANT_OWNER',
    name: 'オーナー',
    scope: 'TENANT',
    permissions: TENANT_OWNER_PERMS,
  },
  {
    code: 'SHOP_MANAGER',
    name: '店長',
    scope: 'SHOP',
    permissions: SHOP_MANAGER_PERMS,
  },
  {
    code: 'SHOP_STAFF',
    name: 'スタッフ',
    scope: 'SHOP',
    permissions: SHOP_STAFF_PERMS,
  },
];
