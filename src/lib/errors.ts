/**
 * アプリケーション共通エラー。
 * - code: 安定した識別子（i18n / テレメトリ / クライアント分岐用）
 * - httpStatus: route handler / action のレスポンスに使用
 * - userMessage: 日本語のユーザー向けメッセージ（UI でそのまま表示可）
 * 内部詳細（cause）はログのみに出し、ユーザーには漏らさない。
 */

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  // 予約ドメイン固有
  | 'SLOT_FULL'
  | 'SLOT_UNAVAILABLE'
  | 'OUTSIDE_BUSINESS_HOURS'
  | 'SHOP_CLOSED'
  | 'STAFF_UNAVAILABLE'
  | 'BOOKING_WINDOW_EXCEEDED'
  | 'LEAD_TIME_VIOLATION'
  | 'CANCELLATION_DEADLINE_PASSED'
  | 'DUPLICATE_BOOKING'
  | 'INVALID_BOOKING_STATE'
  // 課金ドメイン
  | 'STRIPE_NOT_CONFIGURED';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(params: {
    code: AppErrorCode;
    httpStatus: number;
    message: string;
    userMessage: string;
    details?: unknown;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = 'AppError';
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.userMessage = params.userMessage;
    this.details = params.details;
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.userMessage, details: this.details ?? null },
    };
  }
}

// ---- ファクトリ（よく使う形） ----

export const Errors = {
  validation: (userMessage = '入力内容に誤りがあります。', details?: unknown) =>
    new AppError({
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
      message: 'Validation failed',
      userMessage,
      details,
    }),

  unauthorized: (userMessage = 'ログインが必要です。') =>
    new AppError({ code: 'UNAUTHORIZED', httpStatus: 401, message: 'Unauthorized', userMessage }),

  forbidden: (userMessage = 'この操作を行う権限がありません。') =>
    new AppError({ code: 'FORBIDDEN', httpStatus: 403, message: 'Forbidden', userMessage }),

  notFound: (userMessage = '対象が見つかりませんでした。') =>
    new AppError({ code: 'NOT_FOUND', httpStatus: 404, message: 'Not found', userMessage }),

  conflict: (code: AppErrorCode, userMessage: string, details?: unknown) =>
    new AppError({ code, httpStatus: 409, message: code, userMessage, details }),

  rateLimited: (userMessage = 'リクエストが多すぎます。しばらくしてからお試しください。') =>
    new AppError({ code: 'RATE_LIMITED', httpStatus: 429, message: 'Rate limited', userMessage }),

  internal: (cause?: unknown) =>
    new AppError({
      code: 'INTERNAL',
      httpStatus: 500,
      message: 'Internal server error',
      userMessage: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。',
      cause,
    }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** 任意の例外を AppError へ正規化（ログ用途も兼ねる）。 */
export function normalizeError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return Errors.internal(e);
}
