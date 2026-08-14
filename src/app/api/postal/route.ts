/**
 * 郵便番号 → 住所の検索。店舗設定の住所入力を補助する。
 *
 * ブラウザから外部サービスを直接叩かせない理由:
 *  - 広告ブロッカーや社内プロキシで落ちると「入れても出ない」になり、原因が画面に出ない
 *  - 同じ番号を何度も引くので、サーバー側でキャッシュした方が速く、相手にも優しい
 *  - 将来データ提供元を差し替えるとき、画面側を触らずに済む
 *
 * 失敗しても住所は手入力できる（この機能は補助であって必須ではない）。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionUser } from '@/server/auth/authorize';
import { normalizePostalCode, parseZipcloud, type PostalAddress } from '@/lib/postal';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOURCE = 'https://zipcloud.ibsnet.co.jp/api/search';
/** 外部が詰まっても入力を待たせない。人が待てるのはせいぜい数秒。 */
const TIMEOUT_MS = 5_000;
/** 郵便番号データはめったに変わらないので、プロセス内に持って十分。 */
const CACHE_MAX = 2_000;
const cache = new Map<string, PostalAddress | null>();

function remember(code: string, value: PostalAddress | null) {
  // 素朴なFIFO。上限を超えたら古いものから捨てる（無制限に太らせない）
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(code, value);
}

export async function GET(req: NextRequest) {
  // 認証必須。開いた中継サーバーにして第三者に踏み台にされないようにする。
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'ログインが必要です。' }, { status: 401 });

  const code = normalizePostalCode(req.nextUrl.searchParams.get('code'));
  if (!code) {
    return NextResponse.json({ error: '郵便番号は7桁で入力してください。' }, { status: 400 });
  }

  if (cache.has(code)) {
    const hit = cache.get(code) ?? null;
    return hit
      ? NextResponse.json({ address: hit })
      : NextResponse.json({ error: 'この郵便番号の住所が見つかりませんでした。' }, { status: 404 });
  }

  let address: PostalAddress | null = null;
  try {
    const res = await fetch(`${SOURCE}?zipcode=${code}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    address = parseZipcloud(await res.json());
  } catch (e) {
    // 外部都合の失敗は「不具合」ではないので、手入力へ促す文言を返す
    logger.warn({ code, err: String(e) }, '[postal] lookup failed');
    return NextResponse.json(
      { error: '住所の自動入力に失敗しました。お手数ですが直接ご入力ください。' },
      { status: 503 },
    );
  }

  remember(code, address);
  if (!address) {
    return NextResponse.json({ error: 'この郵便番号の住所が見つかりませんでした。' }, { status: 404 });
  }
  return NextResponse.json({ address });
}
