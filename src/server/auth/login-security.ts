/**
 * ログインセキュリティ（割賦販売法/PCI セルフチェック対応）:
 * - アカウントロック: 連続 5 回失敗で 15 分ロック（自動解除・成功でリセット）
 * - 二段階認証: パスワード通過後、メールで 6 桁ワンタイムコード（10 分有効・5 回まで）
 *
 * 2FA はメール送信が構成済みのときのみ強制（テスト/開発では自動的に無効）。
 * デモアカウント（twoFactorExempt=true）は免除（実メールボックスを持たないため）。
 */
import { createHash, randomInt } from 'node:crypto';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { isEmailConfigured, sendEmail } from '@/server/notifications/email';

export const MAX_FAILED_LOGINS = 5; // 割賦販売法チェックリスト「10回以下」を満たす
export const LOCK_MINUTES = 15;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** 有効期限がこの分数以上残っていれば再送しない（メール連打防止） */
const OTP_RESEND_GRACE_MINUTES = 8;

export type LoginOutcome =
  | { kind: 'OK'; userId: string }
  | { kind: 'INVALID' }
  | { kind: 'LOCKED' }
  | { kind: 'OTP_REQUIRED' }
  | { kind: 'OTP_INVALID' };

/** 二段階認証をグローバルに強制するか（メール未構成・ADMIN_2FA=off なら無効）。 */
export function isTwoFactorGloballyEnabled(): boolean {
  return isEmailConfigured() && env.ADMIN_2FA !== 'off';
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** 6 桁コードを発行してメール送信。残り有効期限が十分ならメールは再送しない。 */
export async function issueLoginOtp(
  user: { id: string; email: string; loginOtpExpiresAt: Date | null },
  now: Date = new Date(),
): Promise<void> {
  const remainingMs = (user.loginOtpExpiresAt?.getTime() ?? 0) - now.getTime();
  if (remainingMs > OTP_RESEND_GRACE_MINUTES * 60_000) return; // 直近発行分がまだ有効

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginOtpHash: hashOtp(code),
      loginOtpExpiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
      loginOtpAttempts: 0,
    },
  });
  if (isEmailConfigured()) {
    try {
      await sendEmail({
        to: user.email,
        subject: '【Yoyaku】ログイン確認コード',
        text: [
          'ログイン確認コード（二段階認証）:',
          '',
          `    ${code}`,
          '',
          `有効期限は ${OTP_TTL_MINUTES} 分です。`,
          '心当たりがない場合は、このメールを破棄しパスワードの変更をご検討ください。',
        ].join('\n'),
      });
    } catch (e) {
      // 送信失敗でもログインフローは 500 にしない（ユーザーは「再送」で再試行できる）
      logger.error({ userId: user.id, err: e instanceof Error ? e.message : String(e) }, '[auth] OTP mail send failed');
    }
  } else {
    logger.warn({ userId: user.id }, '[auth] OTP issued but SMTP not configured (code not delivered)');
  }
  logger.info({ userId: user.id }, '[auth] login OTP issued');
}

interface OtpRow {
  id: string;
  loginOtpHash: string | null;
  loginOtpExpiresAt: Date | null;
  loginOtpAttempts: number;
}

/** OTP 検証。成功で消費（ワンタイム）。 */
export async function verifyLoginOtp(user: OtpRow, otp: string, now: Date = new Date()): Promise<boolean> {
  if (!user.loginOtpHash || !user.loginOtpExpiresAt) return false;
  if (user.loginOtpExpiresAt.getTime() < now.getTime()) return false;
  if (user.loginOtpAttempts >= OTP_MAX_ATTEMPTS) return false;
  if (hashOtp(otp) !== user.loginOtpHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { loginOtpAttempts: { increment: 1 } },
    });
    return false;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { loginOtpHash: null, loginOtpExpiresAt: null, loginOtpAttempts: 0 },
  });
  return true;
}

/** 失敗を記録。閾値到達でロック。 */
export async function registerLoginFailure(userId: string, currentCount: number, now: Date = new Date()): Promise<void> {
  const next = currentCount + 1;
  if (next >= MAX_FAILED_LOGINS) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) },
    });
    logger.warn({ userId }, `[auth] account locked for ${LOCK_MINUTES}min after ${next} failed logins`);
  } else {
    await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: next } });
  }
}

/** 成功時: カウンタ/ロック/OTP を掃除し最終ログインを記録。 */
export async function registerLoginSuccess(userId: string, now: Date = new Date()): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      loginOtpHash: null,
      loginOtpExpiresAt: null,
      loginOtpAttempts: 0,
      lastLoginAt: now,
    },
  });
}

/**
 * パスワード + （必要なら）OTP の全ポリシーを通す認証。
 * opts.twoFactorEnabled はテスト用オーバーライド（既定は環境から判定）。
 */
export async function authenticateWithPolicies(
  email: string,
  password: string,
  otp: string | undefined,
  verify: (plain: string, hash: string) => boolean,
  opts?: { now?: Date; twoFactorEnabled?: boolean },
): Promise<LoginOutcome> {
  const now = opts?.now ?? new Date();
  const user = await prisma.user.findFirst({
    where: { email, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      loginOtpHash: true,
      loginOtpExpiresAt: true,
      loginOtpAttempts: true,
      twoFactorExempt: true,
    },
  });
  if (!user || !user.passwordHash) return { kind: 'INVALID' };

  if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
    return { kind: 'LOCKED' };
  }

  if (!verify(password, user.passwordHash)) {
    await registerLoginFailure(user.id, user.failedLoginCount, now);
    return { kind: 'INVALID' };
  }

  const twoFactor = (opts?.twoFactorEnabled ?? isTwoFactorGloballyEnabled()) && !user.twoFactorExempt;
  if (twoFactor) {
    if (!otp) {
      await issueLoginOtp(user, now);
      return { kind: 'OTP_REQUIRED' };
    }
    const ok = await verifyLoginOtp(user, otp, now);
    if (!ok) return { kind: 'OTP_INVALID' };
  }

  await registerLoginSuccess(user.id, now);
  return { kind: 'OK', userId: user.id };
}
