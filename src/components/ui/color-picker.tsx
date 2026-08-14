'use client';

import { useId } from 'react';
import { Check, Pipette, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 色の入力。カラーコードを知らなくても選べることを最優先にする。
 *
 * 以前はテキスト入力だけで、プレースホルダに「#2563eb など」と書いてあった。
 * 「#2563eb」が何色なのか分かる店主はまずいないので、実質「触れない項目」だった。
 * ここでは ①よく使う色を並べてワンタップ ②細かく選びたい人はカラーピッカー
 * ③コードが分かる人は今まで通り手入力、の3経路すべてを用意する。
 */

/** 見本の色。彩度を揃えてあり、どれを選んでも画面が破綻しない。 */
export const COLOR_PRESETS: { value: string; label: string }[] = [
  { value: '#4f46e5', label: 'インディゴ' },
  { value: '#2563eb', label: 'ブルー' },
  { value: '#0891b2', label: 'ターコイズ' },
  { value: '#16a34a', label: 'グリーン' },
  { value: '#ca8a04', label: 'ゴールド' },
  { value: '#ea580c', label: 'オレンジ' },
  { value: '#db2777', label: 'ピンク' },
  { value: '#9333ea', label: 'パープル' },
  { value: '#e11d48', label: 'レッド' },
  { value: '#475569', label: 'グレー' },
];

/** 入力途中でも壊れないよう、正しい6桁の色だけをピッカーへ渡す。 */
export function normalizeHex(v: string, fallback: string): string {
  const s = v.trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

export function ColorPicker({
  value,
  onChange,
  fallback = '#4f46e5',
  allowClear = true,
  clearLabel = '未指定に戻す',
}: {
  value: string;
  onChange: (next: string) => void;
  /** 未指定のときにピッカーへ見せる色（保存はされない） */
  fallback?: string;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const id = useId();
  const current = value.trim().toLowerCase();

  return (
    <div className="grid gap-2">
      {/* ①見本から選ぶ。これが主導線。 */}
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => {
          const active = current === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange(c.value)}
              title={c.label}
              aria-label={c.label}
              aria-pressed={active}
              className={cn(
                'flex size-8 items-center justify-center rounded-full border-2 transition-transform hover:scale-110',
                active ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: c.value }}
            >
              {active && <Check className="size-4 text-white drop-shadow" />}
            </button>
          );
        })}
      </div>

      {/* ②自分で選ぶ ③コードを直接入れる */}
      <div className="flex items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50"
        >
          <Pipette className="size-3.5" />
          好きな色
          <input
            id={id}
            type="color"
            value={normalizeHex(value, fallback)}
            onChange={(e) => onChange(e.target.value)}
            className="size-5 cursor-pointer border-0 bg-transparent p-0"
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="w-28 font-mono text-sm"
          aria-label="カラーコード"
        />
        {allowClear && value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <X className="size-3.5" /> {clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}
