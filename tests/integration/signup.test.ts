/**
 * 公開セルフサーブ登録の統合テスト（実DB）。
 *
 * ここで守りたい不変条件:
 *  - メール検証が済むまでテナントを作らない（いたずら登録でテナント表を汚さない）
 *  - 同じリンクを何度開いてもテナントは1つ（メールクライアントのプリフェッチ対策）
 *  - 公開経路からプラットフォーム管理者は決して作られない
 *  - 課金免除にならない（＝MRRの分母に正しく入る）
 *  - ユーザー列挙ができない（登録済みでも応答は同じ）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { requestSignup, verifySignup } from '@/server/services/signup-service';
import { isAppError, type AppError } from '@/lib/errors';

// メールは送らない（SMTP 未設定環境でも決定的に動かす）
vi.mock('@/server/notifications/email', () => ({
  sendEmail: vi.fn(async () => {}),
}));

const createdTenants: string[] = [];
const emails: string[] = [];

function input(overrides: Partial<Record<string, string>> = {}) {
  const email = overrides.email ?? `signup-${crypto.randomUUID()}@example.com`;
  emails.push(email);
  return {
    tenantName: overrides.tenantName ?? 'テスト美容室株式会社',
    shopName: overrides.shopName ?? 'テストサロン本店',
    ownerName: overrides.ownerName ?? '山田 太郎',
    email,
    password: overrides.password ?? 'passw0rd-test',
    agreed: true as const,
  };
}

/** 直近に発行された検証トークン（生値）はメールにしか無いので、DB から作り直して検証する。 */
async function issueAndGetToken(inp: ReturnType<typeof input>): Promise<string> {
  // requestSignup は tokenHash しか保存しないため、テストでは自前で生値を作って上書きする
  await requestSignup(inp, '203.0.113.10');
  const raw = crypto.randomBytes(32).toString('base64url');
  const row = await prisma.signupRequest.findFirstOrThrow({
    where: { email: inp.email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  await prisma.signupRequest.update({
    where: { id: row.id },
    data: { tokenHash: crypto.createHash('sha256').update(raw).digest('hex') },
  });
  return raw;
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});
afterAll(async () => {
  for (const t of createdTenants) await prisma.tenant.delete({ where: { id: t } }).catch(() => {});
  for (const e of emails) {
    await prisma.signupRequest.deleteMany({ where: { email: e } });
    await prisma.user.deleteMany({ where: { email: e } });
  }
});

describe('申込フェーズ（テナントはまだ作らない）', () => {
  it('申込だけではテナント・ユーザーが作られない', async () => {
    const inp = input();
    await requestSignup(inp, '203.0.113.1');

    expect(await prisma.user.count({ where: { email: inp.email } })).toBe(0);
    const req = await prisma.signupRequest.findFirstOrThrow({ where: { email: inp.email } });
    expect(req.consumedAt).toBeNull();
    expect(req.tenantId).toBeNull();
    // 平文パスワードは保存されていない
    expect(req.passwordHash).not.toContain(inp.password);
    expect(bcrypt.compareSync(inp.password, req.passwordHash)).toBe(true);
    // 生IPも保存されていない
    expect(req.ipHash).not.toBe('203.0.113.1');
  });

  it('登録済みメールでも例外を投げない（列挙防止：応答が変わらない）', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    const r = await verifySignup(token);
    createdTenants.push(r.tenantId);

    // 同じメールで再度申込 → エラーにならず、申込レコードも増えない
    await expect(requestSignup(input({ email: inp.email }), '203.0.113.2')).resolves.toBeUndefined();
    const pending = await prisma.signupRequest.count({ where: { email: inp.email, consumedAt: null } });
    expect(pending).toBe(0);
  });

  it('同一メールからの短時間の連投はレート制限される', async () => {
    const email = `rate-${crypto.randomUUID()}@example.com`;
    emails.push(email);
    await requestSignup(input({ email }), '203.0.113.3');
    await requestSignup(input({ email }), '203.0.113.3');
    await requestSignup(input({ email }), '203.0.113.3');
    try {
      await requestSignup(input({ email }), '203.0.113.3');
      throw new Error('should have thrown');
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      expect((e as AppError).code).toBe('RATE_LIMITED');
    }
  });
});

describe('検証フェーズ（ここでテナント作成＝トライアル開始）', () => {
  it('検証でテナント・店舗・オーナーが作られ、トライアルが始まる', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    const res = await verifySignup(token);
    createdTenants.push(res.tenantId);

    expect(res.alreadyConsumed).toBe(false);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: res.tenantId },
      select: { name: true, billingExempt: true, trialEndsAt: true, planId: true, status: true },
    });
    expect(tenant.name).toBe(inp.tenantName);
    // 商業指標に正しく載るため課金免除であってはならない
    expect(tenant.billingExempt).toBe(false);
    expect(tenant.status).toBe('ACTIVE');
    // トライアルは「検証した今」から30日
    expect(tenant.trialEndsAt).not.toBeNull();
    const daysLeft = (tenant.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(daysLeft).toBeGreaterThan(29);
    expect(daysLeft).toBeLessThanOrEqual(30);
    // プランはサーバーが決める
    expect(tenant.planId).not.toBeNull();

    const shop = await prisma.shop.findFirstOrThrow({ where: { tenantId: res.tenantId } });
    expect(shop.name).toBe(inp.shopName);
    expect(shop.slug).toMatch(/^shop-[0-9a-f]{8}$/); // 一意な仮slug（後から変更可能）

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: inp.email },
      select: { isPlatformAdmin: true, tenantId: true, passwordHash: true, status: true },
    });
    // 公開経路からプラットフォーム管理者は決して作られない
    expect(owner.isPlatformAdmin).toBe(false);
    expect(owner.tenantId).toBe(res.tenantId);
    expect(owner.status).toBe('ACTIVE');
    // 申込時に本人が決めたパスワードでログインできる
    expect(bcrypt.compareSync(inp.password, owner.passwordHash!)).toBe(true);
  });

  it('同じリンクを2回開いてもテナントは1つだけ', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    const first = await verifySignup(token);
    createdTenants.push(first.tenantId);

    const second = await verifySignup(token);
    expect(second.alreadyConsumed).toBe(true);
    expect(second.tenantId).toBe(first.tenantId);
    expect(await prisma.tenant.count({ where: { id: first.tenantId } })).toBe(1);
    expect(await prisma.user.count({ where: { email: inp.email } })).toBe(1);
  });

  it('同時に2回開いてもテナントは1つだけ（並行クリック）', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    const [a, b] = await Promise.all([verifySignup(token), verifySignup(token)]);
    const tenantId = a.tenantId || b.tenantId;
    createdTenants.push(tenantId);
    expect(await prisma.user.count({ where: { email: inp.email } })).toBe(1);
    // 片方は消費済み扱いになる
    expect([a.alreadyConsumed, b.alreadyConsumed].filter(Boolean).length).toBe(1);
  });

  it('期限切れリンクは拒否される', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    await prisma.signupRequest.updateMany({
      where: { email: inp.email, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(verifySignup(token)).rejects.toThrow();
    expect(await prisma.user.count({ where: { email: inp.email } })).toBe(0);
  });

  it('不正なトークンは拒否される', async () => {
    await expect(verifySignup('totally-invalid-token')).rejects.toThrow();
  });

  it('申込〜検証の間に同じメールが登録済みになったら拒否される', async () => {
    const inp = input();
    const token = await issueAndGetToken(inp);
    // 別経路で同じメールのユーザーが出来たと仮定
    const other = await prisma.user.create({
      data: { email: inp.email, name: 'すでに居る人', passwordHash: bcrypt.hashSync('x'.repeat(12), 10), status: 'ACTIVE' },
    });
    await expect(verifySignup(token)).rejects.toThrow();
    await prisma.user.delete({ where: { id: other.id } });
  });
});
