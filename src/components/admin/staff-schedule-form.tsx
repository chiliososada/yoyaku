'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { Check, Plus, X, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import {
  replaceStaffScheduleAction,
  addStaffOverrideAction,
  deleteStaffOverrideAction,
} from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, CheckboxRow, FormError } from './form-kit';
import { minutesToHHmm, hhmmToMinutes } from '@/lib/time';
import { WEEKDAY_JA } from '@/lib/booking-display';

interface RecurringRow {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

// ---- 曜日シフト（全置換） ----
export function RecurringScheduleForm({
  staffId,
  shopId,
  initial,
}: {
  staffId: string;
  shopId: string;
  initial: RecurringRow[];
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, register, handleSubmit, formState: { isSubmitting } } = useForm<{
    rows: { dayOfWeek: string; open: string; close: string }[];
  }>({
    defaultValues: {
      rows: initial.length
        ? initial.map((r) => ({ dayOfWeek: String(r.dayOfWeek), open: minutesToHHmm(r.startMinute), close: minutesToHHmm(r.endMinute) }))
        : [{ dayOfWeek: '1', open: '10:00', close: '19:00' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    setSaved(false);
    // 不正行を捨てない（営業時間フォームと同じ理由）。捨てると「保存しました」だけが出て
    // その曜日の出勤が理由不明で消える。サーバー検証に渡して曜日つきのエラーを出す。
    const rows = data.rows.map((r) => ({
      dayOfWeek: Number(r.dayOfWeek),
      startMinute: hhmmToMinutes(r.open),
      endMinute: hhmmToMinutes(r.close),
    }));
    const res = await replaceStaffScheduleAction(staffId, shopId, { rows });
    if (!res.ok) { setServerError(res.error); return; }
    setSaved(true);
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <FormError message={serverError} />
      {saved && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <Check className="size-4" /> 保存しました。
        </div>
      )}
      <div className="grid gap-2">
        {fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2 rounded-md border bg-white p-2">
            <Select className="w-28" {...register(`rows.${i}.dayOfWeek`)}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAY_JA[d]}曜</option>)}
            </Select>
            <Input type="time" className="w-32" {...register(`rows.${i}.open`)} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" className="w-32" {...register(`rows.${i}.close`)} />
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="削除"><X className="size-4" /></Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => append({ dayOfWeek: '1', open: '10:00', close: '19:00' })}>
        <Plus className="size-4" /> シフトを追加
      </Button>
      <p className="text-xs text-muted-foreground">※ 削除して保存すると、その曜日は非稼働になります。</p>
      <div className="pt-1"><Button type="submit" disabled={isSubmitting}>保存</Button></div>
    </form>
  );
}

// ---- 特定日の上書き（出勤/欠勤） ----
export function StaffOverrideForm({ staffId, shopId }: { staffId: string; shopId: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [ovNotice, setOvNotice] = useState<string | null>(null);
  const { register, handleSubmit, watch, reset, formState: { isSubmitting } } = useForm<{
    date: string; isWorking: boolean; open: string; close: string; note: string;
  }>({ defaultValues: { isWorking: false, open: '10:00', close: '19:00', note: '' } });
  const isWorking = watch('isWorking');

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const res = await addStaffOverrideAction(staffId, shopId, {
      date: data.date,
      isWorking: data.isWorking,
      startMinute: data.isWorking ? hhmmToMinutes(data.open) : undefined,
      endMinute: data.isWorking ? hhmmToMinutes(data.close) : undefined,
      note: data.note || undefined,
    });
    if (!res.ok) { setServerError(res.error); return; }
    // 欠勤にした日にその人の予約が残っていたら知らせる（自動キャンセルはしない）
    const n = res.data?.affectedBookings ?? 0;
    setOvNotice(
      n > 0
        ? `この日にはこのスタッフのご予約が ${n} 件入っています。自動ではキャンセルしていません。` +
            `担当の変更やお客様へのご連絡をご検討ください。`
        : null,
    );
    reset({ isWorking: false, open: '10:00', close: '19:00', note: '', date: '' });
    router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <FormError message={serverError} />
      {ovNotice && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{ovNotice}</span>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">日付</span>
          <Input type="date" {...register('date', { required: true })} />
        </label>
        {isWorking && (
          <>
            <label className="grid gap-1 text-sm"><span className="font-medium">出勤</span><Input type="time" {...register('open')} /></label>
            <label className="grid gap-1 text-sm"><span className="font-medium">退勤</span><Input type="time" {...register('close')} /></label>
          </>
        )}
      </div>
      <CheckboxRow label="この日は出勤（チェックなしは欠勤）" {...register('isWorking')} />
      <Button type="submit" size="sm" disabled={isSubmitting} className="w-fit"><Plus className="size-4" /> 追加</Button>
    </form>
  );
}

export function DeleteOverrideButton({ scheduleId, staffId, shopId }: { scheduleId: string; staffId: string; shopId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid justify-items-end gap-0.5">
      <Button variant="ghost" size="sm" className="h-7 text-destructive" disabled={pending}
        onClick={() => start(async () => {
          setError(null);
          const res = await deleteStaffOverrideAction(scheduleId, staffId, shopId);
          if (!res.ok) {
            setError(res.error ?? '削除に失敗しました。');
            return;
          }
          router.refresh();
        })}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </Button>
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
