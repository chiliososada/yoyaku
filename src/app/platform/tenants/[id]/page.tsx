import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { getTenantDetail } from '@/server/services/platform-service';
import { PageHeader, Panel, StatCard, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { TenantBillingPanel } from '@/components/admin/tenant-billing-panel';
import { formatShortJa } from '@/lib/time';

export const dynamic = 'force-dynamic';

const TENANT_STATUS_LABEL: Record<string, string> = { ACTIVE: '有効', TRIAL: 'トライアル', SUSPENDED: '停止', CANCELLED: '解約' };
const SHOP_STATUS_LABEL: Record<string, string> = { PUBLISHED: '公開', DRAFT: '下書き', CLOSED: '休止' };
const USER_STATUS_LABEL: Record<string, string> = { ACTIVE: '有効', INVITED: '招待中', SUSPENDED: '停止' };

export default async function TenantDetailPage({ params }: { params: { id: string } }) {
  await requirePlatformAdmin();
  const t = await getTenantDetail(params.id);
  if (!t) notFound();

  return (
    <div>
      <Link href="/platform/tenants" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> 商家一覧へ
      </Link>
      <PageHeader
        title={t.name}
        description={`${t.slug} ・ プラン: ${t.plan?.name ?? '—'} ・ 登録 ${formatShortJa(t.createdAt, 'Asia/Tokyo')}`}
        action={<StatusPill status={t.status === 'ACTIVE' ? 'ACTIVE' : t.status === 'SUSPENDED' ? 'CANCELLED' : 'DRAFT'} label={TENANT_STATUS_LABEL[t.status] ?? t.status} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="店舗数" value={t.shops.length} />
        <StatCard label="ユーザー数" value={t.users.length} />
        <StatCard label="総予約数" value={t.bookingCount} />
        <StatCard label="プラン" value={t.plan?.name ?? '—'} />
      </div>

      <div className="mb-6 max-w-md">
        <TenantBillingPanel
          tenantId={t.id}
          billingExempt={t.billingExempt}
          stripeCustomerId={t.stripeCustomerId}
          subscriptionStatus={t.stripeSubscriptionStatus}
          currentPeriodEnd={t.currentPeriodEnd?.toISOString() ?? null}
          trialEndsAt={t.trialEndsAt?.toISOString() ?? null}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">店舗</h2>
          {t.shops.length === 0 ? (
            <EmptyState message="店舗がありません。" />
          ) : (
            <Table>
              <thead>
                <tr><Th>店舗名</Th><Th>状態</Th><Th className="text-right">スタッフ/メニュー/予約</Th><Th></Th></tr>
              </thead>
              <tbody>
                {t.shops.map((s) => (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    <Td><StatusPill status={s.status} label={SHOP_STATUS_LABEL[s.status] ?? s.status} /></Td>
                    <Td className="text-right tabular-nums text-muted-foreground">{s._count.staff} / {s._count.services} / {s._count.bookings}</Td>
                    <Td className="text-right">
                      {s.publicBookingEnabled && (
                        <Link href={`/book/${s.slug}`} target="_blank" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                          予約ページ <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">ユーザー</h2>
          {t.users.length === 0 ? (
            <EmptyState message="ユーザーがいません。" />
          ) : (
            <Panel>
              <ul className="grid gap-2 text-sm">
                {t.users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between border-b py-2 last:border-0">
                    <span><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">{u.email}</span></span>
                    <StatusPill status={u.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'} label={USER_STATUS_LABEL[u.status] ?? u.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
