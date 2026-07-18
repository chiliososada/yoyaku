import { requireTenantUser, hasPermission } from '@/server/auth/authorize';
import { PERMISSIONS } from '@/lib/rbac';
import { listTenantAuditLogs } from '@/server/services/merchant-service';
import { PageHeader, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { formatShortJa } from '@/lib/time';
import { auditActionLabel, auditResourceLabel } from '@/lib/audit-labels';

export const dynamic = 'force-dynamic';

export default async function AdminLogsPage() {
  const user = await requireTenantUser();

  if (!hasPermission(user, PERMISSIONS.AUDIT_READ)) {
    return (
      <div>
        <PageHeader title="操作ログ" />
        <EmptyState message="操作ログを閲覧する権限がありません。オーナーにお問い合わせください。" />
      </div>
    );
  }

  const logs = await listTenantAuditLogs(user.tenantId);

  return (
    <div>
      <PageHeader title="操作ログ" description="管理操作の記録（新しい順・最大100件）" />
      {logs.length === 0 ? (
        <EmptyState message="操作ログはまだありません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>操作</Th>
              <Th>対象</Th>
              <Th>実行者</Th>
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
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
