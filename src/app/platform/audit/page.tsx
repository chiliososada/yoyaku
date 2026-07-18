import { requirePlatformAdmin } from '@/server/auth/authorize';
import { listAuditLogs } from '@/server/services/platform-service';
import { PageHeader, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { formatShortJa } from '@/lib/time';
import { auditActionLabel, auditResourceLabel } from '@/lib/audit-labels';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await requirePlatformAdmin();
  const logs = await listAuditLogs();

  return (
    <div>
      <PageHeader title="監査ログ" description="管理操作の記録（追記専用）" />
      {logs.length === 0 ? (
        <EmptyState message="監査ログはまだありません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>操作</Th>
              <Th>対象</Th>
              <Th>実行者</Th>
              <Th>商家</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td className="text-muted-foreground">{formatShortJa(l.createdAt, 'Asia/Tokyo')}</Td>
                <Td className="font-medium">{auditActionLabel(l.action)}</Td>
                <Td className="text-muted-foreground">
                  {auditResourceLabel(l.resourceType)}
                  {l.resourceId ? ` #${l.resourceId.slice(-6)}` : ''}
                </Td>
                <Td>{l.actor?.name ?? l.actor?.email ?? 'システム'}</Td>
                <Td>{l.tenant?.name ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
