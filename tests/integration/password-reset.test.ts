/**
 * パスワード再設定（自助 + 管理者）の統合テスト。
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import {
  requestPasswordReset,
  resetPasswordWithToken,
  adminResetPassword,
} from '@/server/services/password-service';

const emails: string[] = [];
afterAll(async () => {
  for (const email of emails) {
    await prisma.user.deleteMany({ where: { email } }); // token は onDelete: Cascade
  }
});

async function makeUser(overrides: Partial<{ isPlatformAdmin: boolean; status: 'ACTIVE' | 'SUSPENDED' }> = {}) {
  const email = `pwtest-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  return prisma.user.create({
    data: {
      email,
      name: 'PW Test',
      passwordHash: bcrypt.hashSync('original-pw-123', 10),
      status: overrides.status ?? 'ACTIVE',
      isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    },
  });
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

describe('自助パスワード再設定', () => {
  it('既存ユーザーへの要求はトークンを1件発行し、既存の未使用を無効化する', async () => {
    const u = await makeUser();
    await requestPasswordReset(u.email);
    await requestPasswordReset(u.email); // 2回目
    const active = await prisma.passwordResetToken.count({ where: { userId: u.id, usedAt: null } });
    const total = await prisma.passwordResetToken.count({ where: { userId: u.id } });
    expect(active).toBe(1); // 有効なのは最新1件のみ
    expect(total).toBe(2);
  });

  it('未知のメールでも例外を投げない（列挙防止）', async () => {
    await expect(requestPasswordReset('no-such-user@example.com')).resolves.toBeUndefined();
  });

  it('有効なトークンで新パスワードに変更でき、再利用は不可', async () => {
    const u = await makeUser();
    const raw = crypto.randomBytes(16).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    const ok = await resetPasswordWithToken(raw, 'brand-new-pw-456');
    expect(ok).toBe(true);
    const after = await prisma.user.findUnique({ where: { id: u.id }, select: { passwordHash: true } });
    expect(bcrypt.compareSync('brand-new-pw-456', after!.passwordHash!)).toBe(true);

    // 使用済みトークンは再利用不可
    expect(await resetPasswordWithToken(raw, 'yet-another-pw')).toBe(false);
  });

  it('期限切れトークンは拒否する', async () => {
    const u = await makeUser();
    const raw = crypto.randomBytes(16).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId: u.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resetPasswordWithToken(raw, 'whatever-pw-1')).toBe(false);
  });
});

describe('管理者による強制リセット', () => {
  it('新パスワードを払い出し、旧パスワードは無効になる', async () => {
    const u = await makeUser();
    const { newPassword, email } = await adminResetPassword(u.id);
    expect(email).toBe(u.email);
    expect(newPassword.length).toBeGreaterThanOrEqual(12);
    const after = await prisma.user.findUnique({ where: { id: u.id }, select: { passwordHash: true } });
    expect(bcrypt.compareSync(newPassword, after!.passwordHash!)).toBe(true);
    expect(bcrypt.compareSync('original-pw-123', after!.passwordHash!)).toBe(false);
  });

  it('プラットフォーム管理者は対象外（forbidden）', async () => {
    const admin = await makeUser({ isPlatformAdmin: true });
    await expect(adminResetPassword(admin.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
