import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, getShopConfig } from '@/server/services/merchant-service';
import { jpHolidaysFrom } from '@/lib/jp-holidays';
import { PageHeader, Panel, Table, Th, Td, EmptyState, StatusPill } from '@/components/admin/ui';
import { SpecialDayForm } from '@/components/admin/special-day-form';
import { DeleteSpecialDayButton } from '@/components/admin/delete-buttons';
import { minutesToHHmm, zonedDateString, todayInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

const SPECIAL_TYPE_LABEL: Record<string, string> = {
  CLOSED: '臨時休業',
  SPECIAL_OPEN: '特別営業',
  MODIFIED_HOURS: '営業時間変更',
};

export default async function CalendarPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const { specialDays, shop: shopConfig } = await getShopConfig(user.tenantId, shop.id);

  const today = todayInZone(shop.timezone);
  // 祝日は法令から算出。年をまたいでも一覧が空にならない（＝設定が黙って効かなくなる事故を防ぐ）
  const holidays = jpHolidaysFrom(today, 8);

  return (
    <div className="grid gap-6">
      <div>
        <PageHeader title="休業・特別営業" description="特定日の臨時休業・特別営業を管理します" />
        <div className="mb-4">
          <Panel title="特別営業日を追加">
            <SpecialDayForm shopId={shop.id} closeOnNationalHolidays={shopConfig.closeOnNationalHolidays} />
          </Panel>
        </div>
        {specialDays.length === 0 ? (
          <EmptyState message="特別な営業日は設定されていません。" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>日付</Th>
                <Th>区分</Th>
                <Th>時間</Th>
                <Th>理由</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {specialDays.map((s) => (
                <tr key={s.id}>
                  <Td>{zonedDateString(s.date, 'UTC')}</Td>
                  <Td>
                    <StatusPill status={s.type === 'CLOSED' ? 'CANCELLED' : 'CONFIRMED'} label={SPECIAL_TYPE_LABEL[s.type] ?? s.type} />
                  </Td>
                  <Td className="tabular-nums">
                    {s.openMinute != null && s.closeMinute != null
                      ? `${minutesToHHmm(s.openMinute)} – ${minutesToHHmm(s.closeMinute)}`
                      : '—'}
                  </Td>
                  <Td className="text-muted-foreground">{s.reason ?? '—'}</Td>
                  <Td className="text-right"><DeleteSpecialDayButton id={s.id} shopId={shop.id} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Panel title={`祝日（${shopConfig.closeOnNationalHolidays ? '休業' : '営業'}）`}>
        <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
          {holidays.map((h) => (
            <li key={h.date} className="flex justify-between border-b py-1.5 last:border-0">
              <span className="tabular-nums text-muted-foreground">{h.date}</span>
              <span className="font-medium">{h.name}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
