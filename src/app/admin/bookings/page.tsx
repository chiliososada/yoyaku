import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, listBookings } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { formatJpy, cn } from '@/lib/utils';
import { formatShortJa } from '@/lib/time';
import { BOOKING_STATUS_LABEL } from '@/lib/booking-display';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: '', label: 'すべて' },
  { key: 'CONFIRMED', label: '確定' },
  { key: 'COMPLETED', label: '来店済み' },
  { key: 'CANCELLED', label: 'キャンセル' },
  { key: 'NO_SHOW', label: '無断キャンセル' },
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const status = searchParams.status ?? '';
  const bookings = await listBookings(user.tenantId, shop.id, { status: status || undefined, take: 200 });

  return (
    <div>
      <PageHeader
        title="予約一覧"
        description={`${shop.name} の予約`}
        action={
          <Link href="/admin/bookings/new" className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" /> 代理予約
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/admin/bookings?status=${f.key}` : '/admin/bookings'}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              status === f.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-white hover:border-primary',
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {bookings.length === 0 ? (
        <EmptyState message="該当する予約はありません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>顧客</Th>
              <Th>連絡先</Th>
              <Th>メニュー</Th>
              <Th>担当</Th>
              <Th>状態</Th>
              <Th className="text-right">料金</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <Td>{formatShortJa(b.startAt, shop.timezone)}</Td>
                <Td className="font-medium">{b.customerName}</Td>
                <Td className="text-muted-foreground">{b.customerPhone ?? '—'}</Td>
                <Td>{b.service.name}</Td>
                <Td>{b.staff?.displayName ?? b.staff?.name ?? 'おまかせ'}</Td>
                <Td>
                  <StatusPill status={b.status} label={BOOKING_STATUS_LABEL[b.status] ?? b.status} />
                </Td>
                <Td className="text-right tabular-nums">{formatJpy(b.totalPriceJpy)}</Td>
                <Td>
                  <Link href={`/admin/bookings/${b.id}`} className="text-xs text-primary hover:underline">
                    詳細
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
