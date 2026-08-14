/**
 * 公開セルフサーブ登録。プラットフォーム管理者の手作業なしで
 *   申込 → メール検証 → テナント作成 → トライアル開始
 * まで到達させる。
 *
 * 設計の要点:
 *  - **検証が済むまでテナントを作らない**。未検証の申込は signup_requests に留め置く。
 *    先にテナントを作ると、いたずら登録でテナント表・トライアル台帳・MRR 分母が汚れる。
 *  - **トライアルの起点はメール検証時**（= 実際に使い始められる瞬間）。管理者が作った時刻でも、
 *    フォーム送信時刻でもない。届かないメールで試用期間が減るのは顧客不利益なため。
 *  - **ユーザー列挙を防ぐ**: 登録済みメールでも UI 応答は常に同じ。差は「送るメールの中身」だけ。
 *  - **平文パスワードを保持しない**: 申込時点で bcrypt ハッシュ化して保存する。
 *  - 作成できるのは一般テナントとそのオーナーのみ。プラットフォーム管理者は決して作らない。
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { nowUtc } from '@/lib/time';
import { sendEmail } from '@/server/notifications/email';
import { createTenant } from '@/server/services/platform-mutation-service';
import type { SignupRequestInput } from '@/lib/validation/signup';

/** 検証リンクの有効期限（分）。 */
const VERIFY_TTL_MIN = 60;
/** 同一メールからの申込上限（件/時）。 */
const MAX_PER_EMAIL_PER_HOUR = 3;
/** 同一 IP からの申込上限（件/時）。総当たり・大量登録の抑止。 */
const MAX_PER_IP_PER_HOUR = 10;
/** 公開登録で付与する既定プラン。**サーバーが決める**（クライアントに選ばせない）。 */
const DEFAULT_PLAN_CODE = 'STANDARD';

function sha256(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** 生 IP は保存しない（個人情報の最小化）。レート制限に必要な同一性だけを残す。 */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto.createHash('sha256').update(`${ip}:${env.AUTH_SECRET}`).digest('hex').slice(0, 32);
}

/**
 * 一意な仮 slug を発番。公開URLになるため衝突不可。
 * 日本語の店名はローマ字化しても綺麗にならないので、意味を持たせず短いランダム値にする
 * （店舗設定からいつでも変更でき、変更時は既存の検証を通る）。
 */
async function generateUniqueShopSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = `shop-${crypto.randomBytes(4).toString('hex')}`;
    const taken = await prisma.shop.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw Errors.internal(new Error('failed to allocate unique shop slug'));
}

async function generateUniqueTenantSlug(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidate = `t-${crypto.randomBytes(4).toString('hex')}`;
    const taken = await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw Errors.internal(new Error('failed to allocate unique tenant slug'));
}

/** 直近1時間の申込数でレート制限。DB 集計なので多重起動でも一貫する。 */
async function assertNotRateLimited(email: string, ipHash: string | null): Promise<void> {
  const since = new Date(nowUtc().getTime() - 3_600_000);
  const [byEmail, byIp] = await Promise.all([
    prisma.signupRequest.count({ where: { email, createdAt: { gte: since } } }),
    ipHash ? prisma.signupRequest.count({ where: { ipHash, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (byEmail >= MAX_PER_EMAIL_PER_HOUR || byIp >= MAX_PER_IP_PER_HOUR) {
    logger.warn({ email, byEmail, byIp }, '[signup] rate limited');
    throw Errors.conflict(
      'RATE_LIMITED',
      'お申し込みの回数が上限に達しました。しばらく時間をおいてからお試しください。',
    );
  }
}

/**
 * 申込を受け付け、検証メールを送る。
 * **戻り値で「登録済みかどうか」を漏らさない**（UI 応答は常に同じ）。
 */
export async function requestSignup(input: SignupRequestInput, ip: string | null): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ipHash = hashIp(ip);
  await assertNotRateLimited(email, ipHash);

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // 列挙防止: 画面上は成功と区別できない。本人には「既にアカウントがある」旨だけ知らせる。
    logger.info({ email }, '[signup] already registered — sent notice instead');
    await sendEmail({
      to: email,
      subject: '【Yoyaku】このメールアドレスは既に登録されています',
        text: [
        `${input.ownerName} 様`,
        '',
        'Yoyaku へのお申し込みありがとうございます。',
        'このメールアドレスは既にご登録済みのため、新規のお申し込みは受け付けておりません。',
        '',
        `ログイン: ${env.APP_BASE_URL}/login`,
        `パスワードをお忘れの場合: ${env.APP_BASE_URL}/forgot-password`,
        '',
        'お心当たりがない場合は、このメールは破棄してください。',
        ].join('\n'),
    }).catch((e) => logger.warn({ err: String(e) }, '[signup] notice mail failed'));
    return;
  }

  const raw = crypto.randomBytes(32).toString('base64url');
  const request = await prisma.signupRequest.create({
    data: {
        email,
        tokenHash: sha256(raw),
        tenantName: input.tenantName.trim(),
        shopName: input.shopName.trim(),
        ownerName: input.ownerName.trim(),
        // 平文パスワードは保存しない
        passwordHash: bcrypt.hashSync(input.password, 10),
        ipHash,
        expiresAt: new Date(nowUtc().getTime() + VERIFY_TTL_MIN * 60_000),
    },
    select: { id: true },
  });

  const link = `${env.APP_BASE_URL}/signup/verify?token=${raw}`;
  /**
   * メール送信の失敗をそのまま投げると、呼び出し側では素の Error になり
   * 「処理に失敗しました。時間をおいて再度お試しください。」しか出ない。
   * しかも申込行は既に作られているので、
   *   ①メールは届かない ②何が起きたか分からない ③再試行するたび回数制限を消費し
   *   ④3回で1時間ロック
   * となり、新規顧客が一番大事な最初の1回で完全に詰む。
   * 送れなかった申込は残しても意味が無いので消し、原因が伝わる文言を返す。
   */
  try {
    await sendEmail({
      to: email,
      subject: '【Yoyaku】メールアドレスのご確認（30日間無料トライアル）',
      text: [
        `${input.ownerName} 様`,
        '',
        'Yoyaku へのお申し込みありがとうございます。',
        `以下のリンクを ${VERIFY_TTL_MIN} 分以内に開いて、登録を完了してください。`,
        '',
        link,
        '',
        'リンクを開いた時点で 30 日間の無料トライアルが始まります（カード登録は不要です）。',
        'お心当たりがない場合は、このメールを破棄してください。アカウントは作成されません。',
        '',
        '― Yoyaku / マイアークス株式会社',
      ].join('\n'),
    });
  } catch (e) {
    // 未送信の申込は回数制限の枠だけ食うので取り消す（トークンも無効になる）
    await prisma.signupRequest.delete({ where: { id: request.id } }).catch(() => undefined);
    logger.error({ email, err: String(e) }, '[signup] verification mail FAILED');
    throw Errors.conflict(
      'CONFLICT',
      '確認メールを送信できませんでした。メールアドレスをご確認のうえ、もう一度お試しください。' +
        '繰り返し発生する場合はお手数ですが support@arcs-ai.com までご連絡ください。',
    );
  }
  logger.info({ email }, '[signup] verification mail sent');
}

export interface SignupVerifyResult {
  tenantId: string;
  shopId: string;
  email: string;
  /** 既に消費済みのリンクを再度開いた場合（画面は「完了済み」を出す） */
  alreadyConsumed: boolean;
}

/**
 * 検証トークンを消費してテナントを作る。ここが**トライアル開始点**。
 * 二重クリック・リンク再訪でテナントが二つできないよう、消費を条件付き更新で原子的に確定させる。
 */
export async function verifySignup(rawToken: string): Promise<SignupVerifyResult> {
  const req = await prisma.signupRequest.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: {
      id: true, email: true, tenantName: true, shopName: true, ownerName: true,
      passwordHash: true, expiresAt: true, consumedAt: true, tenantId: true,
    },
  });
  if (!req) throw Errors.notFound('リンクが無効です。お手数ですが、もう一度お申し込みください。');

  if (req.consumedAt) {
    // 既に作成済み。二重作成せず「完了済み」として扱う（メールクライアントのプリフェッチ対策）。
    const shop = req.tenantId
      ? await prisma.shop.findFirst({ where: { tenantId: req.tenantId }, select: { id: true } })
      : null;
    return { tenantId: req.tenantId ?? '', shopId: shop?.id ?? '', email: req.email, alreadyConsumed: true };
  }
  if (req.expiresAt.getTime() < nowUtc().getTime()) {
    throw Errors.conflict('CONFLICT', 'リンクの有効期限が切れています。お手数ですが、もう一度お申し込みください。');
  }

  // 申込〜検証の間に同じメールが他経路で登録された場合
  const taken = await prisma.user.findUnique({ where: { email: req.email }, select: { id: true } });
  if (taken) {
    throw Errors.conflict('CONFLICT', 'このメールアドレスは既に登録済みです。ログインしてご利用ください。');
  }

  // 消費を先に確定（consumedAt が null の行だけ更新）。同時に2回開かれても勝つのは1つだけ。
  const claimed = await prisma.signupRequest.updateMany({
    where: { id: req.id, consumedAt: null },
    data: { consumedAt: nowUtc() },
  });
  if (claimed.count === 0) {
    // 競合で負けた側。相手が作成中/作成済みなので完了扱いにする。
    const after = await prisma.signupRequest.findUnique({ where: { id: req.id }, select: { tenantId: true } });
    const shop = after?.tenantId
      ? await prisma.shop.findFirst({ where: { tenantId: after.tenantId }, select: { id: true } })
      : null;
    return { tenantId: after?.tenantId ?? '', shopId: shop?.id ?? '', email: req.email, alreadyConsumed: true };
  }

  try {
    const created = await createTenant({
      tenantName: req.tenantName,
      tenantSlug: await generateUniqueTenantSlug(),
      shopName: req.shopName,
      shopSlug: await generateUniqueShopSlug(),
      ownerName: req.ownerName,
      ownerEmail: req.email,
      // createTenant は平文を受け取り bcrypt する。ここでは既にハッシュ済みなので
      // 使い捨ての平文を渡さず、作成後にハッシュを差し替える（下記）。
      ownerPassword: crypto.randomBytes(24).toString('base64url'),
      planCode: DEFAULT_PLAN_CODE,
    });
    // 申込時に本人が決めたパスワードを有効化（平文はどこにも残っていない）
    await prisma.user.update({ where: { id: created.ownerId }, data: { passwordHash: req.passwordHash } });
    await prisma.signupRequest.update({ where: { id: req.id }, data: { tenantId: created.tenantId } });

    logger.info({ tenantId: created.tenantId, email: req.email }, '[signup] tenant created via self-serve');
    return { tenantId: created.tenantId, shopId: created.shopId, email: req.email, alreadyConsumed: false };
  } catch (e) {
    // 作成に失敗したら消費を戻す（半端なデータを残さず、ユーザーは同じリンクで再試行できる）
    await prisma.signupRequest.updateMany({ where: { id: req.id, tenantId: null }, data: { consumedAt: null } });
    throw e;
  }
}
