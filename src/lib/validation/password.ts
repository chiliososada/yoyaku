/**
 * パスワードの条件を1か所に集約する。
 *
 * 以前は登録10文字・再設定8文字・スタッフ8文字・テナント作成8文字とバラバラで、
 * 「登録できたパスワードが、再設定画面では弾かれる」という状態になり得た。
 * 入口ごとに強さが違うと、一番弱い入口が実質の強度になるうえ、
 * 利用者にはどれが正しい条件なのか分からない。
 */
import { z } from 'zod';

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 100;

/** 画面に出す条件の説明（フォームのヒントと一致させる）。 */
export const PASSWORD_RULE_TEXT =
  '6文字以上。大文字・小文字・数字をそれぞれ1文字以上含めてください。';

export interface PasswordCheck {
  lengthOk: boolean;
  upperOk: boolean;
  lowerOk: boolean;
  digitOk: boolean;
  ok: boolean;
}

/** 入力中のリアルタイム表示用。送信して初めて弾かれるのを避ける。 */
export function checkPassword(v: string): PasswordCheck {
  const lengthOk = v.length >= PASSWORD_MIN;
  const upperOk = /[A-Z]/.test(v);
  const lowerOk = /[a-z]/.test(v);
  const digitOk = /[0-9]/.test(v);
  return { lengthOk, upperOk, lowerOk, digitOk, ok: lengthOk && upperOk && lowerOk && digitOk };
}

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `パスワードは${PASSWORD_MIN}文字以上にしてください。`)
  .max(PASSWORD_MAX, 'パスワードが長すぎます。')
  // 不足している文字種をまとめて1文へ（1種ずつ指摘すると何度も往復させることになる）
  .superRefine((v, ctx) => {
    const missing: string[] = [];
    if (!/[A-Z]/.test(v)) missing.push('大文字');
    if (!/[a-z]/.test(v)) missing.push('小文字');
    if (!/[0-9]/.test(v)) missing.push('数字');
    if (missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${missing.join('・')}をそれぞれ1文字以上含めてください。`,
      });
    }
  });
