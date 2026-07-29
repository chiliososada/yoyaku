/**
 * 経営指標（プラットフォーム管理者専用）。
 * 各指標の定義は business-metrics-service.ts の冒頭に集約している。
 * **データが足りない指標は数字を作らず「データ不足」と表示する**（DDで信用を失わないため）。
 */
import { CreditCard, Users, TrendingDown, Sparkles, AlertTriangle, Ban, Timer, Coins } from 'lucide-react';
import { requirePlatformAdmin } from '@/server/auth/authorize';
import { getBusinessMetrics } from '@/server/services/business-metrics-service';
import { PageHeader, StatCard, Panel, Table, Th, Td, EmptyState } from '@/components/admin/ui';
import { formatInTz } from '@/lib/time';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const pct = (n: number | null) => (n == null ? 'データ不足' : `${(n * 100).toFixed(1)}%`);

/** 母数が無い指標の共通表示。数字を捏造しないための明示的な状態。 */
function Insufficient({ reason }: { reason: string }) {
  return <span className="text-sm font-normal text-muted-foreground">データ不足（{reason}）</span>;
}

export default async function PlatformMetricsPage() {
  await requirePlatformAdmin();
  const m = await getBusinessMetrics();

  const maxNet = Math.max(1, ...m.monthlyRevenue.map((p) => Math.abs(p.netJpy)));

  return (
    <div>
      <PageHeader
        title="経営指標"
        description={`MRR・解約率・転換率。生成時刻 ${formatInTz(m.generatedAt, 'yyyy/MM/dd HH:mm', 'Asia/Tokyo')}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="現在MRR（月次収益力）" value={yen(m.currentMrrJpy)} icon={CreditCard} />
        <StatCard label="有料顧客数" value={m.payingCustomers} icon={Users} />
        <StatCard label="トライアル中" value={m.trialingTenants} icon={Sparkles} />
        <StatCard label="支払い確認中(past_due)" value={m.pastDueTenants} icon={AlertTriangle} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="新規契約（30日）" value={m.newSubscriptions30d} icon={TrendingDown} />
        <StatCard label="解約（30日）" value={m.churned30d} icon={Ban} />
        <StatCard label="解約率（30日）" value={pct(m.churnRate30d)} icon={TrendingDown} />
        <StatCard label="トライアル転換率" value={pct(m.trialConversionRate)} icon={Sparkles} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Panel title="平均継続月数">
          {m.avgLifetimeMonths == null ? (
            <Insufficient reason="解約実績がまだありません" />
          ) : (
            <p className="flex items-baseline gap-2">
              <Timer className="size-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{m.avgLifetimeMonths.toFixed(1)}</span>
              <span className="text-sm text-muted-foreground">ヶ月</span>
            </p>
          )}
        </Panel>
        <Panel title="LTV（平均単価 × 平均継続月数）">
          {m.ltvJpy == null ? (
            <Insufficient reason="継続月数または有料顧客が不足" />
          ) : (
            <p className="flex items-baseline gap-2">
              <Coins className="size-5 text-muted-foreground" />
              <span className="text-2xl font-bold">{yen(m.ltvJpy)}</span>
            </p>
          )}
        </Panel>
      </div>

      <Panel title="実収推移（直近12ヶ月・入金−返金）" className="mt-4">
        <p className="mb-3 text-xs text-muted-foreground">
          課金台帳の金額スナップショットから算出。プラン価格を改定しても過去の数字は変わりません。
          {m.ledgerSince
            ? `（台帳の記録開始: ${formatInTz(m.ledgerSince, 'yyyy/MM/dd', 'Asia/Tokyo')}）`
            : '（台帳にまだ記録がありません）'}
        </p>
        {m.monthlyRevenue.every((p) => p.netJpy === 0) ? (
          <EmptyState message="入金の記録がまだありません。初回の課金が発生すると、ここに実収が積み上がります。" />
        ) : (
          <div className="grid gap-1.5">
            {m.monthlyRevenue.map((p) => (
              <div key={p.month} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{p.month}</span>
                <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary/70"
                    style={{ width: `${Math.max(p.netJpy > 0 ? 2 : 0, (Math.abs(p.netJpy) / maxNet) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">{yen(p.netJpy)}</span>
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">{p.paymentCount}件</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="プラン別内訳（有料顧客のみ）" className="mt-4">
        {m.planDistribution.length === 0 ? (
          <EmptyState message="有料顧客がまだいません。" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>プラン</Th>
                <Th className="text-right">月額</Th>
                <Th className="text-right">顧客数</Th>
                <Th className="text-right">MRR</Th>
              </tr>
            </thead>
            <tbody>
              {m.planDistribution.map((p) => (
                <tr key={p.planName}>
                  <Td>{p.planName}</Td>
                  <Td className="text-right tabular-nums">{yen(p.priceJpy)}</Td>
                  <Td className="text-right tabular-nums">{p.customers}</Td>
                  <Td className="text-right font-medium tabular-nums">{yen(p.mrrJpy)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel title="指標の定義" className="mt-4">
        <ul className="grid gap-1.5 text-xs text-muted-foreground">
          <li>
            <strong>現在MRR</strong>: 契約中（active / past_due）かつ課金免除でないテナントのプラン価格合計。
            トライアル中は未入金のため含めません。
          </li>
          <li>
            <strong>実収推移</strong>: 各JST暦月の入金 − 返金。課金台帳の発生時点スナップショットのみを使用。
          </li>
          <li>
            <strong>解約率（30日）</strong>: 期間内の解約数 ÷ 期間開始時点の有料顧客数。母数0のときは「データ不足」。
          </li>
          <li>
            <strong>トライアル転換率</strong>: トライアル開始テナントのうち、契約に到達した割合（累計）。
          </li>
          <li>
            <strong>LTV</strong>: 平均単価 × 平均継続月数。解約実績が無い間は算出しません（推計値を出しません）。
          </li>
          <li>
            <strong>課金免除テナント（{m.exemptTenants}件）</strong>: 自社・デモ。すべての商業指標から除外しています。
          </li>
        </ul>
      </Panel>
    </div>
  );
}
