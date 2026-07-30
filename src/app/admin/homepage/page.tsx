import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { getHomepageForEditor } from '@/server/services/shop-homepage-service';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/admin/ui';
import { HomepageForm } from '@/components/admin/homepage-form';
import type { ShopHomepageInput } from '@/lib/validation/admin';

export const dynamic = 'force-dynamic';

export default async function HomepagePage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const { shop: s, data } = await getHomepageForEditor(user.tenantId, shop.id);
  const publicUrl = `${env.APP_BASE_URL.replace(/\/$/, '')}/${s.slug}`;

  const initial = { ...data, businessType: data.businessType as ShopHomepageInput['businessType'] } as ShopHomepageInput;

  return (
    <div>
      <PageHeader
        title="ホームページ"
        description="お店の専属ホームページ（SEO対応）を編集します。検索エンジンからの集客・名刺やチラシに使えるあなた専用のURLです。"
      />
      <HomepageForm
        key={s.id}
        shopId={s.id}
        slug={s.slug}
        publicUrl={publicUrl}
        shopPublished={s.status === 'PUBLISHED'}
        bookingEnabled={s.publicBookingEnabled}
        initial={initial}
      />
    </div>
  );
}
