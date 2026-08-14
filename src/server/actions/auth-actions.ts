'use server';

import { z } from 'zod';
import { passwordSchema } from '@/lib/validation/password';
import { Errors } from '@/lib/errors';
import { requestPasswordReset, resetPasswordWithToken } from '@/server/services/password-service';
import { runAction, type ActionResult } from './action-utils';

const emailSchema = z.object({ email: z.string().trim().email('メールアドレスの形式が正しくありません。') });
const resetSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

/**
 * 自助リセット要求。列挙防止のため、メールの存在有無に関わらず常に成功を返す。
 */
export async function requestPasswordResetAction(email: string): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = emailSchema.parse({ email });
    await requestPasswordReset(parsed.email);
  });
}

/** トークンで新パスワードを確定。無効/期限切れはエラー。 */
export async function resetPasswordAction(token: string, password: string): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = resetSchema.parse({ token, password });
    const ok = await resetPasswordWithToken(parsed.token, parsed.password);
    if (!ok) {
      throw Errors.validation('リンクが無効か、有効期限が切れています。お手数ですが再度お手続きください。');
    }
  });
}
