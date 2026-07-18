/**
 * LINE Messaging API クライアント（サーバー専用）。店長への予約通知に使う。
 * - push: 予約通知（無料枠を消費）。reply: 友だち追加/連携完了の応答（無料）。
 * - 署名検証: Webhook の x-line-signature を channel secret で HMAC-SHA256 検証。
 * env（LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET）未設定なら送信はスタブ扱い。
 */
import crypto from 'crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

const PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';

/** LINE Messaging API が使える設定か（トークン + シークレット）。 */
export function isLineConfigured(): boolean {
  return Boolean(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET);
}

/** 友だち追加リンク（Basic ID がある場合のみ）。QR 表示に使う。 */
export function lineAddFriendUrl(): string | null {
  if (!env.LINE_OA_BASIC_ID) return null;
  const id = env.LINE_OA_BASIC_ID.startsWith('@') ? env.LINE_OA_BASIC_ID : `@${env.LINE_OA_BASIC_ID}`;
  return `https://line.me/R/ti/p/${id}`;
}

/** 純粋関数: 指定 secret で署名を検証（定数時間比較）。テスト可能なようにenv非依存で分離。 */
export function isValidLineSignature(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Webhook 署名検証。env の channel secret を使う。 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!env.LINE_CHANNEL_SECRET) return false;
  return isValidLineSignature(env.LINE_CHANNEL_SECRET, rawBody, signature);
}

/** userId へプッシュ送信（予約通知）。失敗時は throw（outbox が再試行）。 */
export async function sendLineMessage(userId: string, text: string): Promise<void> {
  if (!isLineConfigured()) throw new Error('LINE is not configured');
  const res = await fetch(PUSH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LINE push failed: ${res.status} ${body.slice(0, 300)}`);
  }
}

/** replyToken で応答（友だち追加/連携完了の返信。無料）。失敗はログのみ（応答は best-effort）。 */
export async function replyLineMessage(replyToken: string, text: string): Promise<void> {
  if (!isLineConfigured()) return;
  try {
    const res = await fetch(REPLY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, '[line] reply failed');
    }
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, '[line] reply error');
  }
}
