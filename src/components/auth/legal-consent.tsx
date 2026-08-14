'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TermsBody } from '@/components/legal/terms-body';
import { PrivacyBody } from '@/components/legal/privacy-body';
import { LEGAL_PROSE } from '@/components/legal/legal-prose';
import { cn } from '@/lib/utils';

/**
 * 利用規約・プライバシーポリシーを読んでから同意するためのダイアログ。
 *
 * 以前はチェックボックスの横にリンクがあるだけで、本文は別タブ。
 * 申込の途中で別タブへ飛ばすと入力内容を失う不安があり、実際にはほぼ誰も読まずに
 * チェックだけ入れる。「同意した」という記録の実質が伴わない。
 * ここでは本文をその場で出し、**最後までスクロールするまで同意ボタンを押せない**ようにする。
 */
export function LegalConsentDialog({
  open,
  onClose,
  onAgree,
}: {
  open: boolean;
  onClose: () => void;
  onAgree: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [readToEnd, setReadToEnd] = useState(false);

  /** 末尾まで到達したか。短い画面で最初からスクロール不要な場合も「読了」とみなす。 */
  const checkScrolled = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atEnd) setReadToEnd(true);
  }, []);

  // 開くたびに読了状態をリセットし、その時点でスクロール不要かを判定する
  useEffect(() => {
    if (!open) return;
    setReadToEnd(false);
    const t = setTimeout(checkScrolled, 60);
    return () => clearTimeout(t);
  }, [open, checkScrolled]);

  // 背後のページがスクロールしてしまうのを防ぐ
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc で閉じられるようにする（閉じても同意はしない）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="利用規約とプライバシーポリシー"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-background shadow-xl sm:max-h-[85vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-bold">利用規約・プライバシーポリシー</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={checkScrolled}
          className={cn(
            'flex-1 overflow-y-auto px-4 py-4',
            LEGAL_PROSE,
            // モーダル内は見出しを控えめに（ページより狭いため）
            '[&_h1]:mt-0 [&_h1]:text-lg [&_h2]:text-[15px]',
          )}
        >
          <TermsBody />
          <hr className="my-8" />
          <PrivacyBody />
        </div>

        <div className="border-t px-4 py-3">
          {!readToEnd && (
            <p className="mb-2 text-center text-xs text-muted-foreground">
              最後までお読みいただくと、同意ボタンを押せます。
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              閉じる
            </Button>
            <Button
              type="button"
              disabled={!readToEnd}
              onClick={() => {
                onAgree();
                onClose();
              }}
              className={cn('flex-1', readToEnd && 'shadow-sm')}
            >
              <Check className="size-4" /> 内容に同意する
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
