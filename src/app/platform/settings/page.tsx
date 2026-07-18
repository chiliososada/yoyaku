import { requirePlatformAdmin } from '@/server/auth/authorize';
import { getSystemConfigs } from '@/server/services/platform-service';
import { PageHeader, Panel, Table, Th, Td, EmptyState } from '@/components/admin/ui';

export const dynamic = 'force-dynamic';

export default async function SystemSettingsPage() {
  await requirePlatformAdmin();
  const configs = await getSystemConfigs();

  return (
    <div className="grid gap-6">
      <PageHeader title="システム設定" description="プラットフォーム全体の設定" />

      <Panel title="連携・拡張（予約枠）">
        <ul className="grid gap-2 text-sm">
          <li className="flex items-center justify-between border-b py-2">
            <span>エラー監視 (Sentry)</span>
            <span className="text-muted-foreground">{process.env.SENTRY_DSN ? '有効' : '未設定（予約済み）'}</span>
          </li>
          <li className="flex items-center justify-between border-b py-2">
            <span>決済 (Stripe)</span>
            <span className="text-muted-foreground">{process.env.STRIPE_SECRET_KEY ? '有効' : '未設定（予約済み）'}</span>
          </li>
          <li className="flex items-center justify-between border-b py-2">
            <span>LINE 通知</span>
            <span className="text-muted-foreground">{process.env.LINE_CHANNEL_ACCESS_TOKEN ? '有効' : '未設定（予約済み）'}</span>
          </li>
          <li className="flex items-center justify-between py-2">
            <span>メール通知 (SMTP)</span>
            <span className="text-muted-foreground">{process.env.SMTP_HOST ? '有効' : '未設定（予約済み）'}</span>
          </li>
        </ul>
      </Panel>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">設定値 (system_configs)</h2>
        {configs.length === 0 ? (
          <EmptyState message="システム設定値はありません。" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>キー</Th>
                <Th>値</Th>
                <Th>説明</Th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id}>
                  <Td className="font-medium"><code className="text-xs">{c.key}</code></Td>
                  <Td className="text-muted-foreground"><code className="text-xs">{JSON.stringify(c.value)}</code></Td>
                  <Td className="text-muted-foreground">{c.description ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
