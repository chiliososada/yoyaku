import { requirePlatformAdmin } from '@/server/auth/authorize';
import { listPlatformUsers } from '@/server/services/platform-service';
import { PageHeader, Table, Th, Td, StatusPill, EmptyState } from '@/components/admin/ui';
import { UserStatusButton } from '@/components/admin/user-status-button';
import { ResetPasswordButton } from '@/components/admin/reset-password-button';
import { formatShortJa } from '@/lib/time';

export const dynamic = 'force-dynamic';

const USER_STATUS_LABEL: Record<string, string> = { ACTIVE: '有効', INVITED: '招待中', SUSPENDED: '停止' };

export default async function UsersPage() {
  await requirePlatformAdmin();
  const users = await listPlatformUsers();

  return (
    <div>
      <PageHeader title="ユーザー管理" description={`${users.length} 名のユーザー`} />
      {users.length === 0 ? (
        <EmptyState message="ユーザーがいません。" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>氏名</Th>
              <Th>メール</Th>
              <Th>所属商家</Th>
              <Th>権限</Th>
              <Th>最終ログイン</Th>
              <Th>状態</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <Td className="font-medium">{u.name}</Td>
                <Td className="text-muted-foreground">{u.email}</Td>
                <Td>{u.isPlatformAdmin ? '—（プラットフォーム）' : (u.tenant?.name ?? '—')}</Td>
                <Td>
                  {u.isPlatformAdmin ? (
                    <StatusPill status="CONFIRMED" label="プラットフォーム管理者" />
                  ) : (
                    <span className="text-xs text-muted-foreground">{u._count.memberships} ロール</span>
                  )}
                </Td>
                <Td className="text-muted-foreground">{u.lastLoginAt ? formatShortJa(u.lastLoginAt, 'Asia/Tokyo') : '—'}</Td>
                <Td>
                  <StatusPill status={u.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'} label={USER_STATUS_LABEL[u.status] ?? u.status} />
                </Td>
                <Td className="text-right">
                  {!u.isPlatformAdmin && (
                    <div className="inline-flex items-center gap-2">
                      <ResetPasswordButton userId={u.id} email={u.email} />
                      <UserStatusButton userId={u.id} status={u.status} />
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
