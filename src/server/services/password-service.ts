/**
 * パスワード再設定（自助リセット + 管理者リセット）。
 * トークンは生値をメール/リンクにのみ載せ、DB にはハッシュのみ保存する。
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowUtc } from '@/lib/time';
import { isEmailConfigured, sendEmail } from '@/server/notifications/email';

const RESET_TTL_MIN = 60;
/** 紛らわしい文字（0/O/1/l/I 等）を除いた払い出し用アルファベット。 */
const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generatePassword(len = 12): string {
  let out = '';
  for (let i = 0; i < len; i++) out += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)];
  return out;
}

/**
 * 自助リセットの要求。メール送信（未設定ならログにリンク出力）。
 * メール存在有無は返さない（アカウント列挙防止）。
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim(), status: 'ACTIVE', deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    logger.info({ email }, '[password-reset] 未知/無効メールへの要求（無視）');
    return;
  }

  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(nowUtc().getTime() + RESET_TTL_MIN * 60_000);
  await prisma.$transaction([
    // 既存の未使用トークンを無効化
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: nowUtc() } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt } }),
  ]);

  const link = `${env.APP_BASE_URL}/reset-password?token=${raw}`;
  const text = [
    `${user.name} 様`,
    '',
    'パスワード再設定のリクエストを受け付けました。',
    `以下のリンクから ${RESET_TTL_MIN} 分以内に新しいパスワードを設定してください。`,
    '',
    link,
    '',
    'お心当たりがない場合はこのメールを破棄してください。',
  ].join('\n');

  if (isEmailConfigured()) {
    try {
      await sendEmail({ to: user.email, subject: 'パスワード再設定のご案内', text });
      logger.info({ userId: user.id }, '[password-reset] メール送信');
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e), userId: user.id }, '[password-reset] メール送信失敗');
    }
  } else {
    // SMTP 未設定: 運用者がログからリンクを取得して手動連絡できるようにする
    logger.warn({ userId: user.id, resetLink: link }, '[password-reset] SMTP未設定のためログ出力（このリンクで再設定可）');
  }
}

/** トークンで新パスワードを設定。成功で true、無効/期限切れで false。 */
export async function resetPasswordWithToken(rawToken: string, newPassword: string): Promise<boolean> {
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true },
  });
  if (!token || token.usedAt || token.expiresAt.getTime() < nowUtc().getTime()) return false;

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  await prisma.$transaction([
    // sessionEpoch を進めて既存 JWT を即時失効（パスワード変更＝全端末ログアウト）
    prisma.user.update({ where: { id: token.userId }, data: { passwordHash, sessionEpoch: { increment: 1 } } }),
    // このユーザーの全未使用トークンを無効化（使用済み含め再利用不可に）
    prisma.passwordResetToken.updateMany({ where: { userId: token.userId, usedAt: null }, data: { usedAt: nowUtc() } }),
  ]);
  return true;
}

/**
 * 管理者による強制リセット。新パスワードを払い出して返す（画面で一度だけ表示）。
 * プラットフォーム管理者は対象外（別管理）。
 */
export async function adminResetPassword(userId: string): Promise<{ email: string; newPassword: string }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, isPlatformAdmin: true },
  });
  if (!user) throw Errors.notFound('ユーザーが見つかりません。');
  if (user.isPlatformAdmin) throw Errors.forbidden('プラットフォーム管理者のパスワードはここでは変更できません。');

  const newPassword = generatePassword();
  await prisma.$transaction([
    // sessionEpoch を進めて既存 JWT を即時失効（管理者リセット＝当該ユーザーの全端末ログアウト）
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: bcrypt.hashSync(newPassword, 10), sessionEpoch: { increment: 1 } },
    }),
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: nowUtc() } }),
  ]);
  return { email: user.email, newPassword };
}
