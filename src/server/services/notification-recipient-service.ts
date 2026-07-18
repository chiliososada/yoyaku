/**
 * 店舗の通知先（店長/オーナー/スタッフ）管理。新規予約/変更/キャンセルを LINE/メールで受け取る宛先。
 * 書込は {tenantId, shopId} でスコープ（店舗越境防止）。LINE 連携は短期コード方式:
 *   admin でコード発行 → 店長が公式アカウントを友だち追加しコード送信 → webhook が consume して userId を登録。
 */
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { nowUtc } from '@/lib/time';

/** 予約通知の送信対象（有効な通知先のみ）。booking-service が使用。 */
export async function getActiveRecipients(
  shopId: string,
): Promise<{ channel: 'EMAIL' | 'LINE'; address: string }[]> {
  const rows = await prisma.notificationRecipient.findMany({
    where: { shopId, active: true },
    select: { channel: true, address: true },
  });
  return rows.map((r) => ({ channel: r.channel as 'EMAIL' | 'LINE', address: r.address }));
}

/** 管理画面用: 店舗の通知先一覧。 */
export async function listRecipients(tenantId: string, shopId: string) {
  return prisma.notificationRecipient.findMany({
    where: { tenantId, shopId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, channel: true, address: true, label: true, active: true, createdAt: true },
  });
}

/** メール通知先を追加（即時有効）。 */
export async function addEmailRecipient(
  tenantId: string,
  shopId: string,
  email: string,
  label: string | null,
  createdByUserId: string | null,
) {
  const address = email.trim().toLowerCase();
  return prisma.notificationRecipient.upsert({
    where: { shopId_channel_address: { shopId, channel: 'EMAIL', address } },
    update: { active: true, label: label?.trim() || null },
    create: { tenantId, shopId, channel: 'EMAIL', address, label: label?.trim() || null, createdByUserId },
    select: { id: true },
  });
}

/** 通知先を削除（店舗スコープ確認）。 */
export async function removeRecipient(tenantId: string, shopId: string, id: string) {
  const existing = await prisma.notificationRecipient.findFirst({
    where: { id, tenantId, shopId },
    select: { id: true },
  });
  if (!existing) throw Errors.notFound('通知先が見つかりません。');
  await prisma.notificationRecipient.delete({ where: { id } });
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 紛らわしい 0/O/1/I/L を除外
const CODE_LEN = 6;
const CODE_TTL_MIN = 30;

function genCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

/** LINE 連携コードを発行（30分有効）。店長にこのコードと友だち追加 QR を提示する。 */
export async function createLineLinkCode(
  tenantId: string,
  shopId: string,
  label: string | null,
  createdByUserId: string | null,
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(nowUtc().getTime() + CODE_TTL_MIN * 60_000);
  // 衝突（PK 重複）時は数回リトライ
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    const exists = await prisma.lineLinkCode.findUnique({ where: { code }, select: { code: true } });
    if (exists) continue;
    await prisma.lineLinkCode.create({
      data: { code, tenantId, shopId, label: label?.trim() || null, createdByUserId, expiresAt },
    });
    return { code, expiresAt };
  }
  throw Errors.internal(new Error('link code generation failed'));
}

/**
 * webhook から呼ぶ: コードを消費して LINE userId を通知先に登録。
 * 成功で { shopId, label } を返す（返信メッセージ用）。無効/期限切れ/消費済みは null。
 */
export async function consumeLineLinkCode(
  rawCode: string,
  lineUserId: string,
): Promise<{ shopId: string; label: string | null } | null> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) return null;
  const row = await prisma.lineLinkCode.findFirst({
    where: { code, consumedAt: null, expiresAt: { gt: nowUtc() } },
    select: { code: true, tenantId: true, shopId: true, label: true },
  });
  if (!row) return null;

  await prisma.$transaction([
    prisma.notificationRecipient.upsert({
      where: { shopId_channel_address: { shopId: row.shopId, channel: 'LINE', address: lineUserId } },
      update: { active: true, label: row.label },
      create: {
        tenantId: row.tenantId,
        shopId: row.shopId,
        channel: 'LINE',
        address: lineUserId,
        label: row.label,
      },
    }),
    prisma.lineLinkCode.update({ where: { code: row.code }, data: { consumedAt: nowUtc() } }),
  ]);
  return { shopId: row.shopId, label: row.label };
}

/** LINE ブロック（unfollow）時: その userId の LINE 通知先を無効化。 */
export async function deactivateLineUser(lineUserId: string): Promise<void> {
  await prisma.notificationRecipient.updateMany({
    where: { channel: 'LINE', address: lineUserId, active: true },
    data: { active: false },
  });
}
