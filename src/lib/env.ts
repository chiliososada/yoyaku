/**
 * 環境変数の一元管理と検証（Zod）。
 * - サーバー専用の値はここで検証し、型付きで提供する。
 * - ビルド時に未設定でも落ちないよう、本番以外は安全なデフォルトを与える。
 */
import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APP_TIMEZONE: z.string().default('Asia/Tokyo'),

  DATABASE_URL: isProd
    ? z.string().url()
    : z.string().default('postgresql://booking:booking_local_pw@localhost:5432/booking_saas?schema=public'),
  DIRECT_URL: z.string().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  AUTH_SECRET: isProd
    ? z.string().min(16, 'AUTH_SECRET must be set in production')
    : z.string().default('dev-only-insecure-secret-change-me-1234'),
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),

  // 将来拡張（予約枠）
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // LINE Messaging API（店長への予約通知）。3つ揃うと有効。未設定なら LINE 通知はスタブ（メールは影響なし）。
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional(),
  LINE_CHANNEL_SECRET: z.string().optional(),
  /// 公式アカウントの Basic ID（例: @123abcde）。友だち追加 QR/リンク生成に使う。
  LINE_OA_BASIC_ID: z.string().optional(),
  /// LIFF アプリ ID（例: 1234567890-abcdEfgh）。設定時のみ LINE ネイティブ予約が有効。
  /// NEXT_PUBLIC_ 接頭辞で Next がクライアントへ露出。未設定なら予約画面は通常のウェブ予約として動作。
  NEXT_PUBLIC_LIFF_ID: z.string().optional(),
  /// 管理者ログインの二段階認証（メールOTP）。SMTP 構成済みで自動有効。'off' で明示無効化
  ADMIN_2FA: z.string().optional(),
  /// /platform（運営後台）の第二層防御。Basic 認証（両方設定で有効）と IP 許可リスト（カンマ区切り）
  PLATFORM_BASIC_USER: z.string().optional(),
  PLATFORM_BASIC_PASS: z.string().optional(),
  PLATFORM_IP_ALLOWLIST: z.string().optional(),
  // メール送信（SMTP）。SMTP_HOST 未設定なら通知はログのみ（送信無効）。
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('予約システム <noreply@example.com>'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // 起動を止めるが、何が足りないか明確に出す。
  console.error('❌ 環境変数の検証に失敗しました:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
export type Env = typeof env;
