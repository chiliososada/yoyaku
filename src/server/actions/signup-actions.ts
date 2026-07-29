'use server';

import { signupRequestSchema } from '@/lib/validation/signup';
import { requestSignup } from '@/server/services/signup-service';
import { runAction, getRequestMeta, type ActionResult } from './action-utils';

/**
 * 公開セルフサーブ登録の申込。認証不要（誰でも呼べる）ため、以下はサービス層で担保している:
 *  - レート制限（メール単位・IP単位）
 *  - ユーザー列挙の防止（登録済みでも応答は同じ）
 *  - 作成できるのは一般テナントのみ（プラットフォーム管理者は決して作られない）
 *  - プランはサーバーが決める（入力を受け付けない）
 */
export async function requestSignupAction(input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = signupRequestSchema.parse(input);
    const { ip } = getRequestMeta();
    await requestSignup(parsed, ip);
  });
}
