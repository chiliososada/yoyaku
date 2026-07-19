'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Lightbulb, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GUIDE_STEPS, SECTIONS } from './guide-steps';

export function GuideViewer() {
  const [idx, setIdx] = useState(0);
  const step = GUIDE_STEPS[idx]!;
  const total = GUIDE_STEPS.length;

  const go = useCallback(
    (next: number) => setIdx(Math.min(total - 1, Math.max(0, next))),
    [total],
  );

  // キーボード ←→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(idx + 1);
      if (e.key === 'ArrowLeft') go(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, go]);

  const sectionFirstIndex = useMemo(() => {
    const map = new Map<string, number>();
    GUIDE_STEPS.forEach((s, i) => {
      if (!map.has(s.section)) map.set(s.section, i);
    });
    return map;
  }, []);

  const nextStep = GUIDE_STEPS[idx + 1];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
      {/* ヘッダー */}
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">使い方ガイド</h1>
        <Link
          href="/"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" /> 閉じる
        </Link>
      </div>

      {/* 章タブ */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
          {SECTIONS.map((sec) => {
            const active = step.section === sec;
            return (
              <button
                key={sec}
                onClick={() => go(sectionFirstIndex.get(sec) ?? 0)}
                className={cn(
                  'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'bg-white text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {sec}
              </button>
            );
          })}
        </div>
      </div>

      {/* 進捗 */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            STEP {idx + 1} <span className="font-normal text-muted-foreground">/ {total}</span>
          </span>
          <span>{step.section}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${((idx + 1) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* スクリーンショット + ピン */}
      <div className="relative overflow-hidden rounded-xl border bg-white shadow-md">
        <div className="relative aspect-[16/10]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/guide/${step.img}.jpg`}
            alt={step.title}
            className="absolute inset-0 size-full object-cover"
          />
          {step.pins?.map((pin, i) => (
            <span
              key={i}
              className="absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-lg ring-4 ring-primary/25 sm:size-8"
              style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      </div>

      {/* 次の画像を先読み */}
      {nextStep && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/guide/${nextStep.img}.jpg`} alt="" className="hidden" aria-hidden />
      )}

      {/* 説明 */}
      <div className="mt-5">
        <h2 className="text-base font-bold tracking-tight sm:text-lg">{step.title}</h2>
        <ul className="mt-3 grid gap-2.5">
          {step.points.map((p, i) => {
            const hasPin = (step.pins?.length ?? 0) > i;
            return (
              <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-700">
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    hasPin ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
                  )}
                >
                  {hasPin ? i + 1 : '・'}
                </span>
                {p}
              </li>
            );
          })}
        </ul>
        {step.tip && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            {step.tip}
          </p>
        )}
      </div>

      {/* ナビゲーション */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => go(idx - 1)}
          disabled={idx === 0}
          className="min-w-24"
        >
          <ChevronLeft className="size-4" /> 前へ
        </Button>
        <div className="hidden flex-1 flex-wrap items-center justify-center gap-1.5 sm:flex">
          {GUIDE_STEPS.map((_, i) => (
            <button
              key={i}
              aria-label={`ステップ ${i + 1}`}
              onClick={() => go(i)}
              className={cn(
                'size-2 rounded-full transition-all',
                i === idx ? 'w-5 bg-primary' : 'bg-slate-300 hover:bg-slate-400',
              )}
            />
          ))}
        </div>
        {idx < total - 1 ? (
          <Button onClick={() => go(idx + 1)} className="min-w-24">
            次へ <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button asChild className="min-w-24">
            <Link href="/">完了</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
