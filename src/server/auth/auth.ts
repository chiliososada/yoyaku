/**
 * Auth.js 本体（Node 実行）。Credentials プロバイダで DB 照合する。
 * handlers は route handler、auth はサーバー側セッション取得、signIn/signOut は action で使用。
 * セキュリティポリシー（アカウントロック・メールOTP 二段階認証）は login-security.ts に集約。
 */
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authConfig } from './auth.config';
import { buildSessionUserById } from './session-loader';
import { authenticateWithPolicies } from './login-security';
import './types';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional()
    .or(z.literal('')),
});

/** クライアントへ signIn 結果の code として伝搬されるエラー（next-auth が ?code= に載せる）。 */
class OtpRequiredError extends CredentialsSignin {
  override code = 'otp_required';
}
class OtpInvalidError extends CredentialsSignin {
  override code = 'otp_invalid';
}
class AccountLockedError extends CredentialsSignin {
  override code = 'account_locked';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, otp: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const outcome = await authenticateWithPolicies(
          parsed.data.email,
          parsed.data.password,
          parsed.data.otp || undefined,
          (plain, hash) => bcrypt.compareSync(plain, hash),
        );
        switch (outcome.kind) {
          case 'OTP_REQUIRED':
            throw new OtpRequiredError();
          case 'OTP_INVALID':
            throw new OtpInvalidError();
          case 'LOCKED':
            throw new AccountLockedError();
          case 'INVALID':
            return null;
          case 'OK': {
            const ctx = await buildSessionUserById(outcome.userId);
            if (!ctx) return null;
            return {
              id: ctx.id,
              email: ctx.email,
              name: ctx.name,
              tenantId: ctx.tenantId,
              isPlatformAdmin: ctx.isPlatformAdmin,
              permissions: ctx.permissions,
              shopScopes: ctx.shopScopes,
              tenantWide: ctx.tenantWide,
              sessionEpoch: ctx.sessionEpoch,
            };
          }
        }
      },
    }),
  ],
});
