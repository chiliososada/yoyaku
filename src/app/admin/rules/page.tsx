import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getShopConfig, getServiceOptions, getStaffOptions } from '@/server/services/merchant-service';
import { PageHeader, EmptyState } from '@/components/admin/ui';
import { CapacityRuleForm } from '@/components/admin/capacity-rule-form';

export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<string, string> = { SHOP: '店舗全体', SERVICE: 'メニュー別', STAFF: 'スタッフ別' };

export default async function RulesPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const [{ rules }, services, staff] = await Promise.all([
    getShopConfig(user.tenantId, shop.id),
    getServiceOptions(user.tenantId, shop.id),
    getStaffOptions(user.tenantId, shop.id),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const staffName = new Map(staff.map((s) => [s.id, s.name]));

  const labelFor = (r: (typeof rules)[number]) => {
    if (r.scope === 'SERVICE' && r.serviceId) return `${SCOPE_LABEL.SERVICE}: ${serviceName.get(r.serviceId) ?? '—'}`;
    if (r.scope === 'STAFF' && r.staffId) return `${SCOPE_LABEL.STAFF}: ${staffName.get(r.staffId) ?? '—'}`;
    return SCOPE_LABEL[r.scope] ?? r.scope;
  };

  return (
    <div>
      <PageHeader title="予約ルール" description="同時受付数・受付期間・締切・キャンセル期限などの容量ルール" />
      {rules.length === 0 ? (
        <EmptyState message="予約ルールが設定されていません。" />
      ) : (
        <div className="grid gap-4">
          {rules.map((r) => (
            <CapacityRuleForm
              key={r.id}
              ruleId={r.id}
              shopId={shop.id}
              label={labelFor(r)}
              initial={{
                maxConcurrent: r.maxConcurrent,
                slotIntervalMin: r.slotIntervalMin,
                bookingWindowDays: r.bookingWindowDays,
                leadTimeMinHours: r.leadTimeMinHours,
                cancellationDeadlineHours: r.cancellationDeadlineHours,
              }}
            />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        ※ メニュー別ルールは店舗全体ルールより優先されます。容量超過は予約時にサーバー側で再判定され、オーバーブッキングを防止します。
      </p>
    </div>
  );
}
