/**
 * 構造化ロガー（pino）。操作ログ/運用ログの基盤。
 * 本番は JSON、開発は pino-pretty で整形。
 */
import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: { service: 'booking-saas' },
  redact: {
    paths: ['password', 'passwordHash', '*.password', '*.passwordHash', 'AUTH_SECRET'],
    censor: '[REDACTED]',
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined,
});

/** 子ロガー生成（リクエスト/テナント単位の文脈付与）。 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
