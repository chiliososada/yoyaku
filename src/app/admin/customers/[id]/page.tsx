import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { getCustomerDetail } from '@/server/services/merchant-service';
import { isAppError } from '@/lib/errors';
import { PageHeader, Panel, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { CustomerNoteForm } from '@/components/admin/customer-note-form';
import { formatShortJa } from '@/lib/time';
import { formatJpy } from '@/lib/utils';
import { BOOKING_STATUS_LABEL } from '@/lib/booking-display';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  const user = await requireTenantUser();
  let data;
  try {
    const shopIds = user.isPlatformAdmin || user.tenantWide ? null : user.shopScopes;
    data = await getCustomerDetail(user.tenantId, params.id, shopIds);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const { customer, bookings, stats } = data;
  const tz = 'Asia/Tokyo';

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 顧客一覧へ
      </Link>
      <PageHeader title={customer.name} description={customer.nameKana ?? ''} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-4">
          <Panel title="顧客情報">
            <div className="grid gap-0">
              <Row label="メール" value={customer.email ?? '—'} />
              <Row label="電話" value={customer.phone ?? '—'} />
              <Row label="登録日" value={formatShortJa(customer.createdAt, tz)} />
            </div>
          </Panel>
          <Panel title="カルテ">
            <div className="grid gap-0">
              <Row label="来店回数" value={`${stats.visitCount} 回`} />
              <Row label="累計利用額" value={formatJpy(stats.totalSpent)} />
              <Row label="初回来店" value={stats.firstVisit ? formatShortJa(stats.firstVisit, tz) : '—'} />
              <Row label="最終来店" value={stats.lastVisit ? formatShortJa(stats.lastVisit, tz) : '—'} />
              <Row
                label="次回予約"
                value={stats.nextBooking ? <span className="text-primary">{formatShortJa(stats.nextBooking, tz)}</span> : '—'}
              />
            </div>
          </Panel>
          <Panel title="メモ・好み">
            <CustomerNoteForm
              customerId={customer.id}
              initialNote={customer.note ?? ''}
              canEdit={hasPermission(user, PERMISSIONS.CUSTOMER_WRITE)}
            />
          </Panel>
        </div>

        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">予約履歴</h2>
          {bookings.length === 0 ? (
            <EmptyState message="予約履歴はありません。" />
          ) : (
            <Table>
              <thead>
                <tr><Th>日時</Th><Th>メニュー</Th><Th>担当</Th><Th>状態</Th><Th className="text-right">料金</Th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/admin/bookings/${b.id}`} className="text-primary hover:underline">
                        {formatShortJa(b.startAt, b.shop.timezone)}
                      </Link>
                    </Td>
                    <Td>{b.service.name}</Td>
                    <Td>{b.staff?.displayName ?? b.staff?.name ?? 'おまかせ'}</Td>
                    <Td><StatusPill status={b.status} label={BOOKING_STATUS_LABEL[b.status] ?? b.status} /></Td>
                    <Td className="text-right tabular-nums">{formatJpy(b.totalPriceJpy)}</Td>
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
