import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CalendarCheck, MapPin } from 'lucide-react';
import { getBookingByToken } from '@/server/services/booking-service';
import { isAppError } from '@/lib/errors';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CancelButton } from '@/components/booking/cancel-button';
import { CustomerReschedule } from '@/components/booking/customer-reschedule';
import { BOOKING_STATUS_LABEL, formatDateTimeInTz } from '@/lib/booking-display';
import { formatJpy } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  CONFIRMED: 'success',
  PENDING: 'warning',
  COMPLETED: 'secondary',
  CANCELLED: 'destructive',
  NO_SHOW: 'destructive',
};

export default async function BookingDetailPage({ params }: { params: { token: string } }) {
  let booking;
  try {
    booking = await getBookingByToken(params.token);
  } catch (e) {
    if (isAppError(e) && e.code === 'NOT_FOUND') notFound();
    throw e;
  }

  const cancelled = booking.status === 'CANCELLED';

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="container max-w-lg py-10">
        <div className="mb-6 flex items-center gap-2">
          <CalendarCheck className="size-6 text-primary" />
          <h1 className="text-lg font-bold">予約内容</h1>
        </div>

        <Card>
          <CardContent className="grid gap-4 py-6">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-semibold">
                <MapPin className="size-4 text-primary" /> {booking.shopName}
              </span>
              <Badge variant={STATUS_VARIANT[booking.status] ?? 'secondary'}>
                {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
              </Badge>
            </div>

            <div className="grid gap-2 text-sm">
              <Row label="予約番号" value={booking.id.slice(-8).toUpperCase()} />
              <Row label="担当" value={booking.staffName ?? 'おまかせ'} />
              <Row label="日時" value={`${formatDateTimeInTz(booking.startAt.toISOString(), booking.timezone)} 〜`} />
              <Row label="お名前" value={booking.customerName} />
            </div>

            {/* 料金内訳 */}
            <div className="grid gap-1.5 rounded-lg bg-muted/40 p-3 text-sm">
              {booking.lineItems.map((li, i) => (
                <div key={i} className="grid gap-1">
                  <Row label={li.serviceName} value={formatJpy(li.priceJpy)} />
                  {li.options.map((o, j) => (
                    <div key={j} className="flex justify-between gap-4 pl-4 text-xs text-muted-foreground">
                      <span>＋ {o.name}</span>
                      <span className="tabular-nums">{formatJpy(o.priceJpy)}</span>
                    </div>
                  ))}
                </div>
              ))}
              {booking.nominationFeeJpy > 0 && (
                <Row label="指名料" value={formatJpy(booking.nominationFeeJpy)} />
              )}
              <div className="mt-1 flex justify-between gap-4 border-t pt-2 font-bold">
                <span>合計</span>
                <span className="tabular-nums">{formatJpy(booking.totalPriceJpy)}</span>
              </div>
            </div>

            {!cancelled && booking.cancellable && (
              <div className="grid gap-3 border-t pt-4">
                <CustomerReschedule token={booking.cancellationToken} timezone={booking.timezone} />
                <CancelButton token={booking.cancellationToken} />
              </div>
            )}
            {!cancelled && !booking.cancellable && booking.status === 'COMPLETED' && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                ご来店ありがとうございました。またのご利用をお待ちしております。
              </p>
            )}
            {!cancelled && !booking.cancellable && booking.status === 'NO_SHOW' && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                この予約は来店確認が取れませんでした。ご不明点は店舗へお問い合わせください。
              </p>
            )}
            {!cancelled &&
              !booking.cancellable &&
              booking.status !== 'COMPLETED' &&
              booking.status !== 'NO_SHOW' && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  キャンセル期限（開始の{booking.cancellationDeadlineHours}時間前）を過ぎているため、
                  オンラインでのキャンセルはできません。店舗へ直接ご連絡ください。
                </p>
              )}
            {cancelled && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                この予約はキャンセル済みです。
              </p>
            )}
          </CardContent>
        </Card>

        <div className="mt-4 text-center">
          <Button asChild variant="ghost">
            <Link href={`/book/${booking.shopSlug}`}>店舗の予約ページへ</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
