/**
 * Vitest グローバルセットアップ。
 * - .env を読み込み（Prisma Client は実行時に .env を自動ロードしないため）
 * - 環境変数のテスト用デフォルトを設定
 */
import 'dotenv/config';
import { beforeAll } from 'vitest';

// プロセス TZ は UTC 固定（保存・計算は UTC 前提）
process.env.TZ = 'UTC';
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Tokyo';
// NODE_ENV は vitest が 'test' を設定するため触らない
// 統合テスト用 DB 接続のフォールバック（docker compose と一致）
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://booking:booking_local_pw@localhost:5432/booking_saas?schema=public';

beforeAll(() => {
  // no-op（副作用は import 時に実施済み）
});
