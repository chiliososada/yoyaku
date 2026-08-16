/**
 * 公開URL(slug)の割当ガード。店舗を作る経路と、URLを変更する経路の両方から使う。
 *
 * 公開URLは店舗設定から変更できる。転送は行わない（旧URLは404のまま）が、
 * **手放した文字列を別の店舗が取得することは禁止する**。
 *
 * 禁止しないと次が起きる:
 *   A店が `shinbashi` でポスターを配る → A店が `shinbashi-honten` へ改名 →
 *   `shinbashi` が空く → 別テナントのB店がそれを取得 →
 *   A店のポスターのQRを読んだ客がB店の予約ページに着き、
 *   氏名・電話・メールがB店のテナントへ保存される。
 *
 * 自分が過去に使っていたURLへは戻せる（履歴からその行を消す）。
 */
import type { Prisma } from '@prisma/client';
import { Errors } from '@/lib/errors';

/** prisma でもトランザクションクライアントでも受けられるようにする。 */
export type SlugDb = Prisma.TransactionClient;

export const SLUG_TAKEN_MESSAGE = 'このURLは他の店舗が使用しています。別の文字列をお選びください。';
export const SLUG_RETIRED_MESSAGE =
  'このURLは過去に別の店舗が使用していたため、お使いいただけません。別の文字列をお選びください。';

/**
 * その公開URLが使えるか調べる。使えなければ CONFLICT を投げる。
 *
 * @param shopId 変更の場合に渡す。その店舗自身の現URL・過去URLは「使える」とみなす。
 */
export async function assertShopSlugAvailable(
  db: SlugDb,
  slug: string,
  shopId?: string,
): Promise<void> {
  const live = await db.shop.findFirst({
    where: { slug, ...(shopId ? { NOT: { id: shopId } } : {}) },
    select: { id: true },
  });
  if (live) throw Errors.conflict('CONFLICT', SLUG_TAKEN_MESSAGE);

  const retired = await db.shopSlugHistory.findFirst({
    where: { slug, ...(shopId ? { NOT: { shopId } } : {}) },
    select: { id: true },
  });
  if (retired) throw Errors.conflict('CONFLICT', SLUG_RETIRED_MESSAGE);
}

/**
 * URL変更に伴う履歴の付け替え。**必ず shop.update と同じトランザクションで呼ぶ**。
 * 別々に走らせると、片方だけ成功した瞬間に「誰も持っていないのに取れないURL」や
 * 「手放したのに記録されていないURL」ができる。
 */
export async function recordSlugChange(
  db: SlugDb,
  shopId: string,
  from: string,
  to: string,
): Promise<void> {
  // 手放す方を記録。同じURLを何度も手放しうる（A→B→A→B）ので upsert。
  await db.shopSlugHistory.upsert({
    where: { slug: from },
    create: { shopId, slug: from },
    update: { shopId },
  });
  // 自分の過去URLへ戻す場合、履歴からは外す（現URLと履歴の二重持ちを避ける）。
  await db.shopSlugHistory.deleteMany({ where: { slug: to, shopId } });
}
