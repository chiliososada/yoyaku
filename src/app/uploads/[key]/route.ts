/**
 * アップロード画像の配信。webp を長期キャッシュで返す。認証不要（公開ホームページの画像）。
 * 無効キー/未存在は 404。
 */
import { NextResponse } from 'next/server';
import { readImage } from '@/server/uploads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  const buf = await readImage(params.key);
  if (!buf) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
