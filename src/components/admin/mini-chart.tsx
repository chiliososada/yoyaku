/** 軽量チャート（SVG、サーバーレンダリング・クライアントJS不要）。 */
import { cn } from '@/lib/utils';

export function BarChart({
  data,
  height = 140,
  unit = '',
}: {
  data: { label: string; value: number }[];
  height?: number;
  unit?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const barGap = 4;
  const n = data.length || 1;

  return (
    <div className="w-full">
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * (height - 24));
          return (
            <div key={i} className="group flex flex-1 flex-col items-center justify-end" style={{ gap: barGap }}>
              <span className="text-[10px] font-medium tabular-nums text-slate-500 opacity-0 transition-opacity group-hover:opacity-100">
                {d.value}
                {unit}
              </span>
              <div
                className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                style={{ height: Math.max(2, h) }}
                title={`${d.label}: ${d.value}${unit}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {data.map((d, i) => (
          <div
            key={i}
            className={cn('flex-1 text-center text-[9px] text-muted-foreground', n > 16 && i % 2 === 1 && 'invisible')}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  CONFIRMED: 'bg-green-500',
  COMPLETED: 'bg-slate-400',
  CANCELLED: 'bg-red-400',
  NO_SHOW: 'bg-red-300',
  PENDING: 'bg-amber-400',
};

export function StatusBreakdown({
  data,
  labels,
}: {
  data: Record<string, number>;
  labels: Record<string, string>;
}) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  const order = ['CONFIRMED', 'COMPLETED', 'PENDING', 'CANCELLED', 'NO_SHOW'];
  const entries = order.filter((k) => data[k]).map((k) => [k, data[k]!] as const);

  if (total === 0) return <p className="text-sm text-muted-foreground">データがありません。</p>;

  return (
    <div className="grid gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {entries.map(([k, v]) => (
          <div key={k} className={cn(STATUS_COLORS[k] ?? 'bg-slate-300')} style={{ width: `${(v / total) * 100}%` }} title={`${labels[k]}: ${v}`} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-3">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-full', STATUS_COLORS[k] ?? 'bg-slate-300')} />
            <span className="text-muted-foreground">{labels[k] ?? k}</span>
            <span className="ml-auto font-medium tabular-nums">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
