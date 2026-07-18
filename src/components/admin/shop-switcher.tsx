'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Store, ChevronDown, Check, Plus, Loader2 } from 'lucide-react';
import { selectShopAction } from '@/server/auth/actions';
import { cn } from '@/lib/utils';

export type SwitcherShop = { id: string; name: string; status: string };

export function ShopSwitcher({
  shops,
  currentId,
  canCreateShop = false,
}: {
  shops: SwitcherShop[];
  currentId: string;
  canCreateShop?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = shops.find((s) => s.id === currentId) ?? shops[0];
  if (!current) return null;

  const switchTo = (id: string) => {
    setOpen(false);
    if (id === currentId) return;
    start(async () => {
      await selectShopAction(id);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[60vw] items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50"
      >
        {pending ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" /> : <Store className="size-4 shrink-0 text-primary" />}
        <span className="truncate font-medium">{current.name}</span>
        {current.status === 'DRAFT' && <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">下書き</span>}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-1 w-60 rounded-lg border bg-white p-1 shadow-lg">
            <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">店舗を切り替え</div>
            {shops.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => switchTo(s.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span className="flex-1 truncate">{s.name}</span>
                {s.status === 'DRAFT' && <span className="shrink-0 text-[10px] text-amber-600">下書き</span>}
                {s.id === currentId && <Check className={cn('size-4 shrink-0 text-primary')} />}
              </button>
            ))}
            {canCreateShop && (
              <Link
                href="/admin/shops/new"
                onClick={() => setOpen(false)}
                className="mt-1 flex items-center gap-2 border-t px-2 py-2 text-sm font-medium text-primary hover:bg-slate-50"
              >
                <Plus className="size-4" /> 店舗を追加
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
