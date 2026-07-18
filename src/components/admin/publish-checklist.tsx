import Link from 'next/link';
import { CheckCircle2, Circle, ExternalLink, PartyPopper, ArrowRight } from 'lucide-react';
import type { PublishReadiness } from '@/server/services/merchant-service';

type ItemKey = keyof PublishReadiness['checks'];

const ITEMS: { key: ItemKey; label: string; href: string; hint: string }[] = [
  { key: 'businessHours', label: '営業時間を設定', href: '/admin/business-hours', hint: '曜日ごとの営業時間' },
  { key: 'menu', label: 'メニューを登録', href: '/admin/services', hint: '施術メニューを1件以上' },
  { key: 'staff', label: 'スタッフを登録', href: '/admin/staff', hint: '予約を受けるスタッフを1名以上' },
  { key: 'shifts', label: 'スタッフのシフトを設定', href: '/admin/staff', hint: '出勤時間（未設定だと終日予約不可）' },
  { key: 'menuStaff', label: 'メニューに担当スタッフを割当', href: '/admin/services', hint: '各メニューに担当を1名以上' },
  { key: 'published', label: '店舗を公開（下書き→公開）', href: '/admin/settings', hint: '公開状態を「公開」に' },
  { key: 'onlineBooking', label: 'オンライン予約を有効化', href: '/admin/settings', hint: '「オンライン予約を受け付ける」をON' },
];

/**
 * 開業準備チェックリスト。予約を受け付けられる状態か、不足している設定を明示する。
 * 「設定したのに予約できない/公開しても×」というオンボーディングの落とし穴を防ぐ。
 */
export function PublishChecklist({
  readiness,
  publicUrl,
}: {
  readiness: PublishReadiness;
  publicUrl: string;
}) {
  if (readiness.ready) {
    return (
      <div className="mb-6 rounded-xl border border-success/30 bg-success/10 p-4">
        <div className="flex items-center gap-2 font-semibold text-success">
          <PartyPopper className="size-5" />
          予約受付中です
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          この予約ページをお客様に共有してください。
        </p>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-sm font-medium text-primary hover:bg-accent"
        >
          {publicUrl}
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    );
  }

  const remaining = ITEMS.filter((i) => !readiness.checks[i.key]).length;

  return (
    <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-amber-900">
          開業まであと {remaining} ステップ
        </div>
        <span className="rounded-full bg-amber-200 px-2.5 py-0.5 text-xs font-medium text-amber-900">未公開</span>
      </div>
      <p className="mt-1 text-sm text-amber-800/80">
        以下を完了すると、お客様がオンラインで予約できるようになります。
      </p>
      <ul className="mt-3 grid gap-1.5">
        {ITEMS.map((item) => {
          const done = readiness.checks[item.key];
          const extra =
            item.key === 'shifts' && readiness.staffWithoutShift.length > 0
              ? `未設定: ${readiness.staffWithoutShift.join('、')}`
              : item.key === 'menuStaff' && readiness.menusWithoutStaff.length > 0
                ? `未割当: ${readiness.menusWithoutStaff.join('、')}`
                : null;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className={
                  'group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ' +
                  (done ? 'text-muted-foreground' : 'bg-background/60 hover:bg-background')
                }
              >
                {done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" />
                ) : (
                  <Circle className="size-5 shrink-0 text-amber-400" />
                )}
                <span className="flex-1">
                  <span className={done ? 'line-through' : 'font-medium text-slate-800'}>{item.label}</span>
                  {!done && <span className="ml-2 text-xs text-muted-foreground">{extra ?? item.hint}</span>}
                </span>
                {!done && <ArrowRight className="size-4 shrink-0 text-amber-500 opacity-0 group-hover:opacity-100" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
