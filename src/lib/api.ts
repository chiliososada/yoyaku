/**
 * route handler 用のヘルパー。
 * - AppError / ZodError を一貫した JSON レスポンスへ変換
 * - 例外を監視へ送出
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError, isAppError, Errors } from './errors';
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
        const appErr = Errors.validation('入力内容を確認してください。', e.flatten());
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
