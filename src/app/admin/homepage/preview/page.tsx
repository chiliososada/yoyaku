/**
 * ホームページの下書きプレビュー。
 *
 * 公開ページ（/{slug}）は「店舗が公開 && ホームページON」でないと 404 になるため、
 * 店主は公開前に自分のページを一度も見られなかった（しかも 404 の理由がどこにも出ない）。
 * ここはログイン必須・自テナントの店舗のみを、公開時と同じ見た目で描画する。
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { getHomepagePreview } from '@/server/services/shop-homepage-service';
import { Storefront } from '@/components/homepage/storefront';

export const dynamic = 'force-dynamic';
// 下書きは検索させない
export const metadata = { title: 'ホームページ プレビュー', robots: { index: false, follow: false } };

export default async function HomepagePreviewPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const hp = await getHomepagePreview(user.tenantId, shop.id);
  if (!hp) notFound();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white">
      <Storefront hp={hp} />
      <div className="sticky bottom-0 border-t bg-white/95 px-4 py-3 text-center backdrop-blur">
        <Link
          href="/admin/homepage"
          className="inline-flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" /> 編集画面に戻る
        </Link>
      </div>
    </div>
  );
}
