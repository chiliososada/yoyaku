import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop } from '@/server/services/merchant-service';
import { listRecipients } from '@/server/services/notification-recipient-service';
import { isLineConfigured, lineAddFriendUrl } from '@/server/notifications/line';
import { isEmailConfigured } from '@/server/notifications/email';
import { qrToSvg } from '@/lib/qr';
import { PageHeader, Panel } from '@/components/admin/ui';
import { NotificationRecipients } from '@/components/admin/notification-recipients';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const recipients = await listRecipients(user.tenantId, shop.id);

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
    </div>
  );
}
