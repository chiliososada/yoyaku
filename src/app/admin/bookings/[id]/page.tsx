import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { requireTenantUser, canAccessShop } from '@/server/auth/authorize';
import { getBookingForAdmin, getBookingForReschedule } from '@/server/services/booking-admin-service';
import { isAppError } from '@/lib/errors';
import { PageHeader, Panel, StatusPill } from '@/components/admin/ui';
import { BookingStatusActions } from '@/components/admin/booking-status-actions';
import { RescheduleForm } from '@/components/admin/reschedule-form';
import { formatJpy } from '@/lib/utils';
import { formatShortJa, formatTime, zonedDateString } from '@/lib/time';
import { BOOKING_STATUS_LABEL } from '@/lib/booking-display';

export const dynamic = 'force-dynamic';

const EVENT_LABEL: Record<string, string> = {
  CREATED: '作成', CONFIRMED: '確定', COMPLETED: '来店完了', CANCELLED: 'キャンセル',
  NO_SHOW: '無断キャンセル', RESCHEDULED: '変更', NOTE_ADDED: 'メモ', REMINDER_SENT: 'リマインド送信',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  );
}

export default async function AdminBookingDetail({ params }: { params: { id: string } }) {
  const user = await requireTenantUser();
  let booking;
  try {
    booking = await getBookingForAdmin(user.tenantId, params.id);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  // 店舗スコープ外（別店舗の予約）は 404 扱い。受限スタッフ/店長の店舗越境な閲覧を防止。
  if (!canAccessShop(user, booking.shop.id)) notFound();
  const tz = booking.shop.timezone;
  const canReschedule = booking.status === 'CONFIRMED' || booking.status === 'PENDING';
  const rescheduleInfo = canReschedule ? await getBookingForReschedule(user.tenantId, params.id) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/bookings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 予約一覧へ
      </Link>
      <PageHeader
        title={`予約詳細`}
        description={`予約番号 ${booking.id.slice(-8).toUpperCase()}`}
        action={<StatusPill status={booking.status} label={BOOKING_STATUS_LABEL[booking.status] ?? booking.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="予約情報">
            <div className="grid gap-0">
              <Row label="日時" value={`${formatShortJa(booking.startAt, tz)} – ${formatTime(booking.endAt, tz)}`} />
              <Row label="メニュー" value={booking.service.name} />
              <Row label="担当" value={booking.staff?.displayName ?? booking.staff?.name ?? 'おまかせ'} />
              <Row label="お客様" value={booking.customerName} />
              <Row label="連絡先" value={booking.customerPhone ?? booking.customerEmail ?? '—'} />
              <Row label="人数" value={`${booking.partySize} 名`} />
              <Row label="料金" value={formatJpy(booking.totalPriceJpy)} />
              <Row label="予約経路" value={booking.source === 'ADMIN' ? '管理画面' : booking.source === 'PUBLIC' ? 'オンライン' : booking.source} />
              {booking.note && <Row label="ご要望" value={booking.note} />}
            </div>
          </Panel>

          <div className="mt-4">
            <Panel title="占有時間枠（buffer含む）">
              <ul className="grid gap-1.5 text-sm">
                {booking.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between border-b py-1.5 last:border-0">
                    <span className="tabular-nums">
                      {formatTime(it.startAt, tz)} – {formatTime(it.endAt, tz)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      施術終了 {formatTime(it.serviceEndAt, tz)} / {it.active ? '占有中' : '解放済み'}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <div className="grid content-start gap-4">
          <Panel title="状態管理">
            <BookingStatusActions bookingId={booking.id} status={booking.status} />
          </Panel>
          {rescheduleInfo && (
            <Panel title="日時変更（改期）">
              <RescheduleForm
                bookingId={booking.id}
                timezone={tz}
                currentDate={zonedDateString(booking.startAt, tz)}
                currentStaffId={rescheduleInfo.staffId}
                staffOptions={rescheduleInfo.staffOptions}
              />
            </Panel>
          )}
          <Panel title="操作履歴">
            <ul className="grid gap-2 text-sm">
              {booking.events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between">
                  <span>{EVENT_LABEL[ev.type] ?? ev.type}</span>
                  <span className="text-xs text-muted-foreground">{formatShortJa(ev.createdAt, tz)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
