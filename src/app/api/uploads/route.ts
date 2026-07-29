/**
 * 画像アップロード受け口（店舗ホームページ用）。店舗ユーザー（SHOP_UPDATE）のみ。
 * multipart/form-data: file(Blob), kind(hero|logo|gallery), shopId
 * 返却: { key }。配信は `/uploads/{key}`。
 */
import { NextResponse } from 'next/server';
import { canAccessShop, getSessionUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { prisma } from '@/lib/db';
import { MAX_UPLOAD_BYTES, saveImage, type ImageKind } from '@/server/uploads';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KINDS: readonly ImageKind[] = ['hero', 'logo', 'gallery'];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });
  if (!user.tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!hasPermission(user, PERMISSIONS.SHOP_UPDATE)) {
    return NextResponse.json({ error: 'この操作の権限がありません。' }, { status: 403 });
  }

  // 本体を読む前に Content-Length で拒否（巨大ボディの全量バッファリングによるメモリDoS対策。
  // multipart のオーバーヘッド分を上乗せして判定。後段の file.size チェックが正）。
  // ヘッダ欠落（chunked 等）を許すと事前チェックを迂回して formData() が全量バッファリング
  // してしまうため、正当なブラウザ multipart には必ず付く Content-Length を必須にする。
  const rawLen = req.headers.get('content-length');
  const contentLength = Number(rawLen);
  if (rawLen === null || !Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json({ error: 'Content-Length が必要です。' }, { status: 411 });
  }
  if (contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: '画像が大きすぎます（最大12MB）。' }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid form' }, { status: 400 });
  }

  const file = form.get('file');
  const kind = String(form.get('kind') ?? '') as ImageKind;
  const shopId = String(form.get('shopId') ?? '');
  if (!(file instanceof Blob)) return NextResponse.json({ error: '画像ファイルを選択してください。' }, { status: 400 });
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
  if (!shopId) return NextResponse.json({ error: 'shopId required' }, { status: 400 });
  if (!canAccessShop(user, shopId)) return NextResponse.json({ error: 'この店舗を操作する権限がありません。' }, { status: 403 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: '画像が大きすぎます（最大12MB）。' }, { status: 413 });
  }

  // 店舗がこのテナントのものか確認（tenantId は上で non-null を保証済み）
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, tenantId: user.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!shop) return NextResponse.json({ error: 'shop not found' }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const key = await saveImage(buf, kind);
    return NextResponse.json({ key });
  } catch (e) {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, '[uploads] processing failed');
    return NextResponse.json({ error: '画像を処理できませんでした。別の画像をお試しください。' }, { status: 400 });
  }
}
