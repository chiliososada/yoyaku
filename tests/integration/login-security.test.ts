/**
 * ログインセキュリティ統合テスト（実DB）:
 * アカウントロック（5回失敗→15分）・メールOTP二段階認証・免除フラグ。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/db';
import {
  authenticateWithPolicies,
  MAX_FAILED_LOGINS,
  OTP_MAX_ATTEMPTS,
} from '@/server/auth/login-security';

const verify = (plain: string, hash: string) => bcrypt.compareSync(plain, hash);
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PASSWORD = 'correct-horse-battery';
const userIds: string[] = [];

async function makeUser(overrides: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: {
      email: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@login-sec.test`,
      name: 'セキュリティ試験',
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      status: 'ACTIVE',
      ...overrides,
    },
    select: { id: true, email: true },
  });
  userIds.push(user.id);
  return user;
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('アカウントロック', () => {
  it(`${MAX_FAILED_LOGINS} 回連続失敗でロックされ、正しいパスワードでも拒否`, async () => {
    const u = await makeUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      const r = await authenticateWithPolicies(u.email, 'wrong-password', undefined, verify, {
        twoFactorEnabled: false,
      });
      expect(r.kind).toBe('INVALID');
    }
    const locked = await authenticateWithPolicies(u.email, PASSWORD, undefined, verify, {
      twoFactorEnabled: false,
    });
    expect(locked.kind).toBe('LOCKED');

    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { lockedUntil: true } });
    expect(row?.lockedUntil).not.toBeNull();
    // 15分後（自動解除）を過ぎれば成功できる
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const ok = await authenticateWithPolicies(u.email, PASSWORD, undefined, verify, {
      twoFactorEnabled: false,
    });
    expect(ok.kind).toBe('OK');
    // 成功でカウンタ/ロックがリセットされる
    const after = await prisma.user.findUnique({
      where: { id: u.id },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    expect(after).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('失敗が閾値未満なら成功でリセットされる', async () => {
    const u = await makeUser();
    await authenticateWithPolicies(u.email, 'bad1', undefined, verify, { twoFactorEnabled: false });
    await authenticateWithPolicies(u.email, 'bad2', undefined, verify, { twoFactorEnabled: false });
    const ok = await authenticateWithPolicies(u.email, PASSWORD, undefined, verify, { twoFactorEnabled: false });
    expect(ok.kind).toBe('OK');
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { failedLoginCount: true } });
    expect(row?.failedLoginCount).toBe(0);
  });

  it('存在しないユーザーは INVALID（存在有無を漏らさない）', async () => {
    const r = await authenticateWithPolicies('no-such@login-sec.test', 'x', undefined, verify, {
      twoFactorEnabled: false,
    });
    expect(r.kind).toBe('INVALID');
  });
});

describe('二段階認証（メールOTP）', () => {
  it('パスワード通過後、OTP 未提示なら OTP_REQUIRED になりコードが保存される', async () => {
    const u = await makeUser();
    const r = await authenticateWithPolicies(u.email, PASSWORD, undefined, verify, { twoFactorEnabled: true });
    expect(r.kind).toBe('OTP_REQUIRED');
    const row = await prisma.user.findUnique({
      where: { id: u.id },
      select: { loginOtpHash: true, loginOtpExpiresAt: true },
    });
    expect(row?.loginOtpHash).toBeTruthy();
    expect(row?.loginOtpExpiresAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('正しい OTP でログイン成功し、コードは消費される（再利用不可）', async () => {
    const u = await makeUser();
    await prisma.user.update({
      where: { id: u.id },
      data: { loginOtpHash: sha256('123456'), loginOtpExpiresAt: new Date(Date.now() + 5 * 60_000), loginOtpAttempts: 0 },
    });
    const ok = await authenticateWithPolicies(u.email, PASSWORD, '123456', verify, { twoFactorEnabled: true });
    expect(ok.kind).toBe('OK');
    // 消費済み → 同じコードで再ログインは OTP_INVALID
    await prisma.user.update({ where: { id: u.id }, data: {} });
    const replay = await authenticateWithPolicies(u.email, PASSWORD, '123456', verify, { twoFactorEnabled: true });
    expect(replay.kind).toBe('OTP_INVALID');
  });

  it('誤った OTP は OTP_INVALID で試行回数が増える・上限で無効', async () => {
    const u = await makeUser();
    await prisma.user.update({
      where: { id: u.id },
      data: { loginOtpHash: sha256('654321'), loginOtpExpiresAt: new Date(Date.now() + 5 * 60_000), loginOtpAttempts: 0 },
    });
    const bad = await authenticateWithPolicies(u.email, PASSWORD, '000000', verify, { twoFactorEnabled: true });
    expect(bad.kind).toBe('OTP_INVALID');
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { loginOtpAttempts: true } });
    expect(row?.loginOtpAttempts).toBe(1);

    // 上限まで失敗させると正しいコードでも拒否
    await prisma.user.update({ where: { id: u.id }, data: { loginOtpAttempts: OTP_MAX_ATTEMPTS } });
    const exhausted = await authenticateWithPolicies(u.email, PASSWORD, '654321', verify, { twoFactorEnabled: true });
    expect(exhausted.kind).toBe('OTP_INVALID');
  });

  it('期限切れコードは拒否', async () => {
    const u = await makeUser();
    await prisma.user.update({
      where: { id: u.id },
      data: { loginOtpHash: sha256('111111'), loginOtpExpiresAt: new Date(Date.now() - 1000), loginOtpAttempts: 0 },
    });
    const r = await authenticateWithPolicies(u.email, PASSWORD, '111111', verify, { twoFactorEnabled: true });
    expect(r.kind).toBe('OTP_INVALID');
  });

  it('免除フラグ（デモ用）は 2FA 有効でも OTP 不要', async () => {
    const u = await makeUser({ twoFactorExempt: true });
    const r = await authenticateWithPolicies(u.email, PASSWORD, undefined, verify, { twoFactorEnabled: true });
    expect(r.kind).toBe('OK');
  });
});
