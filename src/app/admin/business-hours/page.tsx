import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getShopConfig } from '@/server/services/merchant-service';
import { PageHeader, Panel } from '@/components/admin/ui';
import { BusinessHoursForm } from '@/components/admin/business-hours-form';

export const dynamic = 'force-dynamic';

export default async function BusinessHoursPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const { businessHours } = await getShopConfig(user.tenantId, shop.id);

  return (
    <div>
      <PageHeader title="営業時間" description="曜日ごとの営業時間（昼休みなどの分割にも対応）" />
      <Panel title="営業時間の編集">
        <BusinessHoursForm
          key={shop.id}
          shopId={shop.id}
          initial={businessHours.map((b) => ({ dayOfWeek: b.dayOfWeek, openMinute: b.openMinute, closeMinute: b.closeMinute }))}
        />
      </Panel>
      <p className="mt-3 text-xs text-muted-foreground">
        ※ 祝日は店舗設定の「祝日休業」に従います。特定日の休業・特別営業は「休業・特別営業」で管理します。
      </p>
    </div>
  );
}
