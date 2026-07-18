import { requirePlatformAdmin } from '@/server/auth/authorize';
import { AdminShell } from '@/components/admin/admin-shell';

export const dynamic = 'force-dynamic';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();
  return (
    <AdminShell
      variant="platform"
      brandLabel="プラットフォーム管理"
      userName={user.name ?? '管理者'}
      userEmail={user.email ?? ''}
    >
      {children}
    </AdminShell>
  );
}
