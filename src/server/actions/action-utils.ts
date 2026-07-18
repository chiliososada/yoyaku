/**
 * server action 共通ユーティリティ。例外を直列化可能な結果へ変換。
 */
import { headers } from 'next/headers';
import { isAppError } from '@/lib/errors';
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
