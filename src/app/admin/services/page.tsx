import Link from 'next/link';
import { Plus, TriangleAlert } from 'lucide-react';
import { requireTenantUser } from '@/server/auth/authorize';
import { getPrimaryShop, listServices } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { formatJpy } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  const user = await requireTenantUser();
  const shop = await getPrimaryShop(user.tenantId);
  const services = await listServices(user.tenantId, shop.id);

  return (
    <div>
      <PageHeader
        title="メニュー管理"
        description={`${shop.name} のサービスメニュー`}
        action={
          <Link href="/admin/services/new" className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" /> 新規登録
          </Link>
        }
      />
      {services.length === 0 ? (
        <EmptyState message="メニューが登録されていません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>メニュー</Th>
              <Th>カテゴリ</Th>
              <Th className="text-right">所要</Th>
              <Th className="text-right">後バッファ</Th>
              <Th className="text-right">同時受付</Th>
              <Th className="text-right">担当数</Th>
              <Th className="text-right">料金</Th>
              <Th>状態</Th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td>
                  <Link href={`/admin/services/${s.id}`} className="inline-flex items-center gap-2 font-medium text-primary hover:underline">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color ?? '#94a3b8' }} />
                    {s.name}
                  </Link>
                </Td>
                <Td className="text-muted-foreground">{s.category ?? '—'}</Td>
                <Td className="text-right tabular-nums">{s.durationMin}分</Td>
                <Td className="text-right tabular-nums">{s.bufferAfterMin}分</Td>
                <Td className="text-right tabular-nums">{s.capacity}</Td>
                <Td className="text-right tabular-nums">
                  {/* 担当が必要なのに0名＝この時点で予約を受けられない。
                      一覧で見えないと「公開したのに誰も予約できない」の原因に辿り着けない。 */}
                  {s.requiresStaff && s._count.serviceStaff === 0 ? (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      <TriangleAlert className="size-3" /> 担当未設定
                    </span>
                  ) : (
                    s._count.serviceStaff
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {s.salePriceJpy != null ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground line-through">{formatJpy(s.priceJpy)}</span>
                      <span className="font-semibold text-rose-600">{formatJpy(s.salePriceJpy)}</span>
                    </span>
                  ) : (
                    formatJpy(s.priceJpy)
                  )}
                </Td>
                <Td>
                  <StatusPill status={s.isActive ? 'ACTIVE' : 'INACTIVE'} label={s.isActive ? '公開' : '非公開'} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
