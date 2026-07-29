/**
 * 店舗ホームページ用の画像アップロード保存（サーバー専用）。
 *
 * - アップロード時に sharp で回転補正・リサイズ・webp 変換して保存（配信時は無加工で高速）。
 * - 保存先はマウントボリューム（本番 /app/uploads）。キーは不透明なランダム値＋拡張子で、
 *   パストラバーサル不可（英数と一部記号のみ許可）。
 * - 画像はすべて公開ホームページに載る前提の「公開コンテンツ」。配信ルートは認証不要、
 *   アップロードルートは店舗ユーザー認証必須。
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export type ImageKind = 'hero' | 'logo' | 'gallery';

/**
 * 種別ごとの最大寸法と品質。
 * hero は保存時に切り抜かず（fit:'inside'）、絵柄を保ったまま縮小のみ。
 * 表示側でヒーロー枠に合わせて中央基準に切り抜くため、ここで切ると二重に切り抜かれて
 * 極端な拡大表示になる（横長バナー等で顕著）。
 */
const KIND: Record<ImageKind, { w: number; h: number; fit: 'cover' | 'inside'; quality: number }> = {
  hero: { w: 2000, h: 2000, fit: 'inside', quality: 80 },
  logo: { w: 512, h: 512, fit: 'inside', quality: 90 },
  gallery: { w: 1400, h: 1400, fit: 'inside', quality: 78 },
};

/** 生入力の上限（バイト）。ルート側でも弾くが二重防御。 */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** 保存キーの形式（配信ルートの検証と共有）。ディレクトリ区切り・`..` は不可。 */
export const UPLOAD_KEY_RE = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*)\.webp$/;

function uploadsDir(): string {
  return env.UPLOADS_DIR && env.UPLOADS_DIR.trim() !== ''
    ? env.UPLOADS_DIR
    : path.join(process.cwd(), 'uploads');
}

export function isValidUploadKey(key: string): boolean {
  return UPLOAD_KEY_RE.test(key);
}

/**
 * 画像を処理して保存し、保存キー（例 `a1b2....webp`）を返す。
 * 画像として解釈できない入力は例外。
 */
export async function saveImage(input: Buffer, kind: ImageKind): Promise<string> {
  const cfg = KIND[kind];
  // sharp は例外時にストリームを残さないよう try/catch で包む。
  const webp = await sharp(input, { failOn: 'error' })
    .rotate() // EXIF の向きを反映
    .resize(cfg.w, cfg.h, { fit: cfg.fit, withoutEnlargement: true })
    .webp({ quality: cfg.quality })
    .toBuffer();

  const key = `${randomUUID().replace(/-/g, '')}.webp`;
  const dir = uploadsDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, key), webp);
  logger.info({ key, kind, bytes: webp.length }, '[uploads] image saved');
  return key;
}

/** キーからファイルを読む。無効キー/未存在は null。 */
export async function readImage(key: string): Promise<Buffer | null> {
  if (!isValidUploadKey(key)) return null;
  try {
    return await readFile(path.join(uploadsDir(), key));
  } catch {
    return null;
  }
}

/** ベストエフォート削除（失敗しても投げない）。 */
export async function deleteImage(key: string): Promise<void> {
  if (!isValidUploadKey(key)) return;
  try {
    await unlink(path.join(uploadsDir(), key));
  } catch {
    /* 既に無い等は無視 */
  }
}
