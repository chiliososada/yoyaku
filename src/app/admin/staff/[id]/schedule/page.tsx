import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, canAccessShop } from '@/server/auth/authorize';
import { getPrimaryShop, getStaffSchedule } from '@/server/services/merchant-service';
import { isAppError } from '@/lib/errors';
import { PageHeader, Panel, Table, Th, Td, EmptyState, StatusPill } from '@/components/admin/ui';
import { RecurringScheduleForm, StaffOverrideForm, DeleteOverrideButton } from '@/components/admin/staff-schedule-form';
import { minutesToHHmm, zonedDateString } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function StaffSchedulePage({ params }: { params: { id: string } }) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  let data;
  try {
    data = await getStaffSchedule(user.tenantId, params.id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  // 店舗スコープ外（別店舗のスタッフ）は 404。
  if (!canAccessShop(user, data.staff.shopId)) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/admin/staff/${params.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> スタッフ編集へ
        </Link>
        <PageHeader title="シフト設定" description={`${data.staff.displayName ?? data.staff.name} の勤務シフト`} />
      </div>

      <Panel title="曜日シフト（定常）">
        <RecurringScheduleForm staffId={params.id} shopId={shop.id} initial={data.recurring} />
      </Panel>

      <div>
        <Panel title="特定日の出勤・欠勤を追加">
          <StaffOverrideForm staffId={params.id} shopId={shop.id} />
        </Panel>
        <div className="mt-4">
          {data.overrides.length === 0 ? (
            <EmptyState message="特定日の上書きはありません。" />
          ) : (
            <Table>
              <thead>
                <tr><Th>日付</Th><Th>区分</Th><Th>時間</Th><Th>メモ</Th><Th></Th></tr>
              </thead>
              <tbody>
                {data.overrides.map((o) => (
                  <tr key={o.id}>
                    <Td>{o.date ? zonedDateString(o.date, 'UTC') : '—'}</Td>
                    <Td><StatusPill status={o.isWorking ? 'CONFIRMED' : 'CANCELLED'} label={o.isWorking ? '出勤' : '欠勤'} /></Td>
                    <Td className="tabular-nums">
                      {o.isWorking && o.startMinute != null && o.endMinute != null ? `${minutesToHHmm(o.startMinute)} – ${minutesToHHmm(o.endMinute)}` : '—'}
                    </Td>
                    <Td className="text-muted-foreground">{o.note ?? '—'}</Td>
                    <Td className="text-right"><DeleteOverrideButton scheduleId={o.id} staffId={params.id} shopId={shop.id} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
