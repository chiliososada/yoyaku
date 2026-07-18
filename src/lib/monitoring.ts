/**
 * エラー監視の抽象化（Sentry 予約枠）。
 *
 * いまは Sentry パッケージを直接依存させず、薄い抽象だけ提供する。
 * 本番で Sentry を有効化する手順:
 *   1) `npm i @sentry/nextjs`
 *   2) `instrumentation.ts` で Sentry.init を呼ぶ
 *   3) 下の captureException 内の TODO を Sentry.captureException に差し替え
 * SENTRY_DSN 未設定時は no-op。これにより監視は「予約済みだが無効」状態で安全に動く。
 */
import { logger } from './logger';
import { env } from './env';
import { isAppError } from './errors';

const sentryEnabled = Boolean(env.SENTRY_DSN);

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  // 想定内の業務エラー（4xx）は監視に送らず、ログのみ。
  if (isAppError(error) && error.httpStatus < 500) {
    logger.warn({ err: error, code: error.code, ...context }, 'handled app error');
    return;
  }

  logger.error({ err: error, ...context }, 'unhandled error');

  if (sentryEnabled) {
    // TODO(sentry): import * as Sentry from '@sentry/nextjs';
    //               Sentry.captureException(error, { extra: context });
  }
}

export function captureMessage(message: string, context?: Record<string, unknown>): void {
  logger.info({ ...context }, message);
  if (sentryEnabled) {
    // TODO(sentry): Sentry.captureMessage(message, { extra: context });
  }
}

export const monitoring = { captureException, captureMessage, enabled: sentryEnabled };
