/**
 * セッション即時失効（FIX-A / HIGH）の統合テスト（実DB）。
 *
 * JWT はサーバー側に状態を持たないため、停止・無効化・パスワードリセットを即時反映するには
 *  (1) 失効イベントで users.sessionEpoch を進める（このファイルが検証する「トリガ側」）
 *  (2) 毎リクエスト getSessionUser が token.sessionEpoch と DB を照合する（authorize.ts）
 * の2段構えが要る。ここでは失効トリガが確実に epoch を進める／状態を落とすことを保証する。
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import {
  setStaffLogin,
  disableStaffLogin,
  softDeleteStaff,
} from '@/server/services/merchant-mutation-service';
import { setUserStatus } from '@/server/services/platform-mutation-service';
import { adminResetPassword, resetPasswordWithToken } from '@/server/services/password-service';
import { seedScenario, cleanupTenant } from '../helpers/seed';

const createdTenants: string[] = [];
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await cleanupTenant(t);
});

/** ログイン付きスタッフを用意し、その userId と現在の sessionEpoch を返す。 */
async function seedStaffUser() {
  const sc = await seedScenario({ staffCount: 1 });
  createdTenants.push(sc.tenantId);
  const staffId = sc.staffIds[0]!;
  const email = `rev_${crypto.randomUUID()}@example.com`;
  const { userId } = await setStaffLogin(sc.tenantId, sc.shopId, staffId, email, 'initpass123');
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sessionEpoch: true } });
  return { sc, staffId, userId, email, epoch0: user!.sessionEpoch };
}

async function readUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, deletedAt: true, sessionEpoch: true },
  });
}

describe('セッション即時失効: 失効トリガが sessionEpoch を進める', () => {
  it('disableStaffLogin: 停止 + epoch++（発行済みトークンを無効化）', async () => {
    const { sc, staffId, userId, epoch0 } = await seedStaffUser();
    await disableStaffLogin(sc.tenantId, sc.shopId, staffId);
    const after = await readUser(userId);
    expect(after!.status).toBe('SUSPENDED');
    expect(after!.sessionEpoch).toBe(epoch0 + 1);
  });

  it('softDeleteStaff: スタッフ削除で紐付く User も停止 + epoch++（退職者を失効）', async () => {
    const { sc, staffId, userId, epoch0 } = await seedStaffUser();
    await softDeleteStaff(sc.tenantId, sc.shopId, staffId);
    const after = await readUser(userId);
    expect(after!.status).toBe('SUSPENDED');
    expect(after!.sessionEpoch).toBe(epoch0 + 1);
  });

  it('setUserStatus(SUSPENDED): epoch++ / (ACTIVE)復帰では進めない', async () => {
    const { userId, epoch0 } = await seedStaffUser();
    await setUserStatus(userId, 'SUSPENDED');
    const suspended = await readUser(userId);
    expect(suspended!.status).toBe('SUSPENDED');
    expect(suspended!.sessionEpoch).toBe(epoch0 + 1);

    // 復帰は既存トークンを失効させる必要はない（epoch 据え置き）
    await setUserStatus(userId, 'ACTIVE');
    const reactivated = await readUser(userId);
    expect(reactivated!.status).toBe('ACTIVE');
    expect(reactivated!.sessionEpoch).toBe(epoch0 + 1);
  });

  it('adminResetPassword: ACTIVE のまま epoch++（全端末ログアウト、旧トークンは epoch 不一致で失効）', async () => {
    const { userId, epoch0 } = await seedStaffUser();
    await adminResetPassword(userId);
    const after = await readUser(userId);
    expect(after!.status).toBe('ACTIVE'); // 状態は変えない
    expect(after!.sessionEpoch).toBe(epoch0 + 1);
  });

  it('resetPasswordWithToken: 自助リセットで epoch++', async () => {
    const { userId, epoch0 } = await seedStaffUser();
    const raw = crypto.randomBytes(16).toString('hex');
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const ok = await resetPasswordWithToken(raw, 'reset-new-pw-789');
    expect(ok).toBe(true);
    const after = await readUser(userId);
    expect(after!.status).toBe('ACTIVE');
    expect(after!.sessionEpoch).toBe(epoch0 + 1);
    expect(bcrypt.compareSync('reset-new-pw-789', (await prisma.user.findUnique({
      where: { id: userId }, select: { passwordHash: true },
    }))!.passwordHash!)).toBe(true);
  });
});

describe('セッション即時失効: 照合ロジックの意味論（getSessionUser 相当）', () => {
  // getSessionUser は auth() のリクエストコンテキストを要するため、その判定条件を
  // DB 状態に対して直接評価して等価性を確認する（status/deletedAt/epoch 照合）。
  function isTokenValid(
    token: { epoch: number },
    db: { status: string; deletedAt: Date | null; sessionEpoch: number } | null,
  ): boolean {
    if (!db || db.status !== 'ACTIVE' || db.deletedAt) return false;
    return (token.epoch ?? 0) === db.sessionEpoch;
  }

  it('停止・epoch 前進のいずれでも旧トークンは失効する', async () => {
    const { userId, epoch0 } = await seedStaffUser();
    const oldToken = { epoch: epoch0 };
    // 発行直後は有効
    expect(isTokenValid(oldToken, await readUser(userId))).toBe(true);

    // パスワードリセットで epoch 前進 → 旧トークンは epoch 不一致で失効
    await adminResetPassword(userId);
    expect(isTokenValid(oldToken, await readUser(userId))).toBe(false);

    // 停止でも失効（status != ACTIVE）
    await setUserStatus(userId, 'SUSPENDED');
    expect(isTokenValid({ epoch: epoch0 + 1 }, await readUser(userId))).toBe(false);
  });

  it('導入前に発行された epoch を持たないトークン（=0扱い）は既定 epoch(0) と一致し維持される', async () => {
    const { userId } = await seedStaffUser();
    // 失効イベントが無ければ epoch は 0 のまま。undefined→0 とみなして一致。
    const legacyToken = { epoch: undefined as unknown as number };
    expect(isTokenValid(legacyToken, await readUser(userId))).toBe(true);
  });
});
