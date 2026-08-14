'use client';

import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * 目のアイコンで表示/非表示を切り替えられるパスワード入力。
 *
 * 伏せ字のままだと、条件（大文字・小文字・数字）を満たしているかを
 * 自分の入力を見て確かめられず、スマートフォンでは特に打ち間違いに気づけない。
 * 既定は非表示のまま（肩越しに見られるリスクを増やさない）。
 */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const labelId = useId();

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        // アイコンに文字が重ならないよう右側に余白を確保
        className={cn('pr-11', className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // フォーム送信の対象外・タブ順の邪魔にしない
        tabIndex={-1}
        aria-label={visible ? 'パスワードを隠す' : 'パスワードを表示する'}
        aria-pressed={visible}
        aria-describedby={labelId}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
      <span id={labelId} className="sr-only">
        入力したパスワードの表示を切り替えます
      </span>
    </div>
  );
}
