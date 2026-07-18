import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { PageHeader, Panel } from '@/components/admin/ui';
import { QrMaterial } from '@/components/admin/qr-material';
import { qrToSvg, qrToPngDataUrl } from '@/lib/qr';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function QrPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const bookingUrl = `${env.APP_BASE_URL}/book/${shop.slug}`;
  // LINE ネイティブ予約の入口（LIFF 設定時のみ）。スキャン→LINE内で予約→確認/リマインドも LINE。
  const lineBookingUrl = env.NEXT_PUBLIC_LIFF_ID
    ? `https://liff.line.me/${env.NEXT_PUBLIC_LIFF_ID}/book/${shop.slug}`
    : null;
  const [qrSvg, qrPng, lineQrSvg, lineQrPng] = await Promise.all([
    qrToSvg(bookingUrl),
    qrToPngDataUrl(bookingUrl),
    lineBookingUrl ? qrToSvg(lineBookingUrl) : Promise.resolve(null),
    lineBookingUrl ? qrToPngDataUrl(lineBookingUrl) : Promise.resolve(null),
  ]);
  const live = shop.status === 'PUBLISHED' && shop.publicBookingEnabled;

  return (
    <div>
      <PageHeader title="予約QR・集客物料" description={`${shop.name} の予約ページへ誘導するQRコード`} />

      {!live && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            この店舗はまだ公開予約を受け付けていないため、QRを読み取っても予約できません。
            <Link href="/admin/settings" className="ml-1 font-medium underline">
              店舗設定
            </Link>
            で「公開」と「オンライン予約」を有効にしてください。
          </div>
        </div>
      )}

      <Panel>
        <QrMaterial
          shopName={shop.name}
          bookingUrl={bookingUrl}
          slug={shop.slug}
          qrSvg={qrSvg}
          qrPng={qrPng}
          lineBookingUrl={lineBookingUrl}
          lineQrSvg={lineQrSvg}
          lineQrPng={lineQrPng}
        />
      </Panel>
    </div>
  );
}
