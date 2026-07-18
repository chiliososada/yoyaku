import Link from 'next/link';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getShopConfig } from '@/server/services/merchant-service';
import { PageHeader } from '@/components/admin/ui';
import { ShopSettingsForm } from '@/components/admin/shop-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const { shop: s } = await getShopConfig(user.tenantId, shop.id);
  const settings = (s.settings as Record<string, unknown>) ?? {};
  const shopCapacity = typeof settings.shopCapacity === 'number' ? settings.shopCapacity : 1;

  return (
    <div>
      <PageHeader
        title="店舗設定"
        description="店舗の基本情報と公開予約の設定"
        action={
          <Link href={`/book/${s.slug}`} target="_blank" className="rounded-md border px-3 py-2 text-sm hover:bg-slate-50">
            公開ページを見る
          </Link>
        }
      />
      {/* key=店舗ID: 店舗切替時にフォームを再マウント（RHF の defaultValues は初回のみ反映のため、
          切替後に旧店舗の値を新店舗へ上書き保存してしまう事故を防ぐ） */}
      <ShopSettingsForm
        key={s.id}
        shopId={s.id}
        initial={{
          name: s.name,
          description: s.description ?? '',
          phone: s.phone ?? '',
          email: s.email ?? '',
          postalCode: s.postalCode ?? '',
          prefecture: s.prefecture ?? '',
          city: s.city ?? '',
          address: s.address ?? '',
          status: s.status,
          publicBookingEnabled: s.publicBookingEnabled,
          closeOnNationalHolidays: s.closeOnNationalHolidays,
          shopCapacity,
        }}
      />
    </div>
  );
}
