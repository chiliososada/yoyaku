import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { MapPin, CalendarCheck } from 'lucide-react';
import { getPublicShop } from '@/server/services/public-shop-service';
import { isAppError } from '@/lib/errors';
import { env } from '@/lib/env';
import { BookingWizard } from '@/components/booking/booking-wizard';

export const dynamic = 'force-dynamic';

async function loadShop(slug: string) {
  try {
    return await getPublicShop(slug);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const shop = await loadShop(params.slug);
  return { title: shop ? `${shop.name} | ご予約` : 'ご予約' };
}

export default async function BookPage({ params }: { params: { slug: string } }) {
  const shop = await loadShop(params.slug);
  if (!shop) notFound();

  return (
    <main className="min-h-screen bg-gradient-to-b from-accent/40 via-slate-50 to-slate-50">
      <header className="sticky top-0 z-30 border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/65">
        <div className="container flex items-center gap-3 py-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CalendarCheck className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-foreground sm:text-xl">{shop.name}</h1>
            {(shop.prefecture || shop.address) && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
                <MapPin className="size-3.5 shrink-0" />
                <span className="truncate">
                  {[shop.prefecture, shop.city, shop.address].filter(Boolean).join(' ')}
                </span>
              </p>
            )}
          </div>
        </div>
      </header>
      <div className="container max-w-2xl py-6 sm:py-8">
        {/* LIFF ID はサーバー側の env から実行時に渡す（NEXT_PUBLIC_ のビルド時インライン
            に頼らないため、値の変更はコンテナ再起動のみで反映される）。未設定なら null = ウェブ予約。 */}
        <BookingWizard shop={shop} liffId={env.NEXT_PUBLIC_LIFF_ID ?? null} />
      </div>
    </main>
  );
}
