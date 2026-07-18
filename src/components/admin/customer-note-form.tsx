'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextArea } from './form-kit';
import { updateCustomerNoteAction } from '@/server/actions/admin-actions';

export function CustomerNoteForm({
  customerId,
  initialNote,
  canEdit = true,
}: {
  customerId: string;
  initialNote: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 編集権限（CUSTOMER_WRITE）が無い場合は読み取り専用表示（保存ボタンを出さない）
  if (!canEdit) {
    return (
      <div className="min-h-16 whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
        {initialNote || 'メモはまだありません。'}
      </div>
    );
  }

  const save = () => {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await updateCustomerNoteAction(customerId, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2">
      <TextArea
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        placeholder="好み・アレルギー・接客メモなど（例: いつも短め希望 / パーマ地肌弱い）"
        className="min-h-24"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : '保存'}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" /> 保存しました
          </span>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
