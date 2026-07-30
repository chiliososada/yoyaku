'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { specialDaySchema, type SpecialDayInput } from '@/lib/validation/admin';
import { AlertTriangle } from 'lucide-react';
import { addSpecialDayAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, Select, FormError } from './form-kit';
import { hhmmToMinutes } from '@/lib/time';

export function SpecialDayForm({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SpecialDayInput>({
    resolver: zodResolver(specialDaySchema),
    defaultValues: { type: 'CLOSED', reason: '' },
  });
  const type = watch('type');

  const onSubmit = async (data: SpecialDayInput) => {
    setServerError(null);
    setNotice(null);
    const res = await addSpecialDayAction(shopId, data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    // 休業にした日に予約が残っていたら知らせる。
    // 勝手に取り消すと客への連絡なしに来店が無になるため、判断は店主に委ねる。
    const n = res.data?.affectedBookings ?? 0;
    if (n > 0) {
      setNotice(
        `この日にはすでに ${n} 件のご予約が入っています。自動ではキャンセルしていません。` +
          `「予約」画面から内容をご確認のうえ、お客様へご連絡ください。`,
      );
    }
    reset({ type: 'CLOSED', reason: '', date: '' });
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3">
      <FormError message={serverError} />
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="日付" required error={errors.date?.message}>
          <Input type="date" {...register('date')} />
        </Field>
        <Field label="区分" error={errors.type?.message}>
          <Select {...register('type')}>
            <option value="CLOSED">臨時休業</option>
            <option value="SPECIAL_OPEN">特別営業</option>
            <option value="MODIFIED_HOURS">営業時間変更</option>
          </Select>
        </Field>
      </div>
      {type !== 'CLOSED' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="開店" error={errors.openMinute?.message}>
            <Input type="time" defaultValue="10:00" {...register('openMinute', { setValueAs: (v: string) => (v ? hhmmToMinutes(v) : undefined) })} />
          </Field>
          <Field label="閉店" error={errors.closeMinute?.message}>
            <Input type="time" defaultValue="18:00" {...register('closeMinute', { setValueAs: (v: string) => (v ? hhmmToMinutes(v) : undefined) })} />
          </Field>
        </div>
      )}
      <Field label="理由（任意）" error={errors.reason?.message}>
        <Input {...register('reason')} placeholder="研修のため 等" />
      </Field>
      <Button type="submit" disabled={isSubmitting} className="w-fit">
        <Plus className="size-4" /> 追加
      </Button>
    </form>
  );
}
