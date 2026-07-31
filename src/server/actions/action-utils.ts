/**
 * server action 共通ユーティリティ。例外を直列化可能な結果へ変換。
 */
import { headers } from 'next/headers';
import { ZodError } from 'zod';
import { isAppError } from '@/lib/errors';
import { zodUserMessage } from '@/lib/zod-message';
import { captureException } from '@/lib/monitoring';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; code?: string };

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    if (isAppError(e)) {
      if (e.httpStatus >= 500) captureException(e);
      return { ok: false, error: e.userMessage, code: e.code };
    }
    /**
     * 入力検証エラーは「不具合」ではなく「直せる入力ミス」。
     * ここで汎用文言に潰すと、スキーマ側で用意した具体的な指摘
     * （どの曜日のどの時刻が重なっているか等）が一切届かず、
     * 店主には「時間をおいて再度お試しください」＝永久に直らない案内しか出ない。
     * 監視にも送らない（サーバー障害ではないため）。
     */
    if (e instanceof ZodError) {
      return { ok: false, error: zodUserMessage(e), code: 'VALIDATION_ERROR' };
    }
    captureException(e);
    return { ok: false, error: '処理に失敗しました。時間をおいて再度お試しください。' };
  }
}

/** リクエストの IP / UA を取得（監査用）。 */
export function getRequestMeta(): { ip: string | null; userAgent: string | null } {
  try {
    const h = headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
    return { ip, userAgent: h.get('user-agent') };
  } catch {
    return { ip: null, userAgent: null };
  }
}
