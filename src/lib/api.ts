/**
 * route handler 用のヘルパー。
 * - AppError / ZodError を一貫した JSON レスポンスへ変換
 * - 例外を監視へ送出
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, isAppError, Errors } from './errors';
import { zodUserMessage } from './zod-message';
import { captureException } from './monitoring';

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(error: AppError) {
  return NextResponse.json(error.toJSON(), { status: error.httpStatus });
}

/** route handler を包み、例外を整形レスポンスへ変換する。 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (e) {
      if (e instanceof ZodError) {
        // スキーマ側の具体的な文言をそのまま返す（潰すと利用者が何を直せばよいか分からない）。
        // details には従来どおり項目別の内訳も載せる。
        const appErr = Errors.validation(zodUserMessage(e), e.flatten());
        return jsonError(appErr);
      }
      if (isAppError(e)) {
        if (e.httpStatus >= 500) captureException(e);
        return jsonError(e);
      }
      captureException(e);
      return jsonError(Errors.internal(e));
    }
  };
}
