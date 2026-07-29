import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { listRecipients } from '@/server/services/notification-recipient-service';
import { listFailedNotifications } from '@/server/services/notification-service';
import { isLineConfigured, lineAddFriendUrl } from '@/server/notifications/line';
import { isEmailConfigured } from '@/server/notifications/email';
import { formatBookingDateTime } from '@/lib/time';
import { qrToSvg } from '@/lib/qr';
import { PageHeader, Panel } from '@/components/admin/ui';
import { NotificationRecipients } from '@/components/admin/notification-recipients';
import { FailedNotifications } from '@/components/admin/failed-notifications';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const [recipients, failed] = await Promise.all([
    listRecipients(user.tenantId, shop.id),
    listFailedNotifications(user.tenantId, { shopId: shop.id }),
  ]);

  const addFriendUrl = lineAddFriendUrl();
  const addFriendQrSvg = addFriendUrl ? await qrToSvg(addFriendUrl) : null;

  return (
    <div>
      <PageHeader
        title="通知設定・通知先"
        description={`${shop.name} の新規予約・変更・キャンセルを、店長のLINE/メールに通知します`}
      />
      <Panel>
        <NotificationRecipients
          shopId={shop.id}
          recipients={recipients.map((r) => ({
            id: r.id,
            channel: r.channel as 'EMAIL' | 'LINE',
            address: r.address,
            label: r.label,
            active: r.active,
          }))}
          lineConfigured={isLineConfigured()}
          emailConfigured={isEmailConfigured()}
          addFriendUrl={addFriendUrl}
          addFriendQrSvg={addFriendQrSvg}
        />
      </Panel>

      <Panel title="配信できなかった通知" className="mt-6">
        <FailedNotifications
          shopId={shop.id}
          items={failed.map((f) => ({
            id: f.id,
            channel: f.channel,
            template: f.template,
            recipient: f.recipient,
            attempts: f.attempts,
            lastError: f.lastError,
            createdAtLabel: formatBookingDateTime(f.createdAt, shop.timezone),
            booking: f.booking
              ? {
                  id: f.booking.id,
                  customerName: f.booking.customerName,
                  startAtLabel: formatBookingDateTime(f.booking.startAt, f.booking.timezone),
                }
              : null,
          }))}
        />
      </Panel>
    </div>
  );
}
