'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { Check, Plus, X } from 'lucide-react';
import { replaceBusinessHoursAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, FormError } from './form-kit';
import { minutesToHHmm, hhmmToMinutes } from '@/lib/time';
import { WEEKDAY_JA } from '@/lib/booking-display';

interface Row {
  dayOfWeek: string;
  open: string;
  close: string;
}
interface FormShape {
  rows: Row[];
}

export interface BusinessHourInitial {
  dayOfWeek: number;
  openMinute: number;
  closeMinute: number;
}

export function BusinessHoursForm({ shopId, initial }: { shopId: string; initial: BusinessHourInitial[] }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { control, register, handleSubmit, formState: { isSubmitting } } = useForm<FormShape>({
    defaultValues: {
      rows: initial.length
        ? initial.map((r) => ({ dayOfWeek: String(r.dayOfWeek), open: minutesToHHmm(r.openMinute), close: minutesToHHmm(r.closeMinute) }))
        : [{ dayOfWeek: '1', open: '10:00', close: '19:00' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });

  const onSubmit = async (data: FormShape) => {
    setServerError(null);
    setSaved(false);
    const rows = data.rows
      .map((r) => ({ dayOfWeek: Number(r.dayOfWeek), openMinute: hhmmToMinutes(r.open), closeMinute: hhmmToMinutes(r.close) }))
      .filter((r) => r.closeMinute > r.openMinute);
    const res = await replaceBusinessHoursAction(shopId, { rows });
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-3">
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
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>{WEEKDAY_JA[d]}曜</option>
              ))}
            </Select>
            <Input type="time" className="w-32" {...register(`rows.${i}.open`)} />
            <span className="text-muted-foreground">–</span>
            <Input type="time" className="w-32" {...register(`rows.${i}.close`)} />
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)} aria-label="削除">
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => append({ dayOfWeek: '1', open: '10:00', close: '19:00' })}>
        <Plus className="size-4" /> 時間帯を追加
      </Button>
      <p className="text-xs text-muted-foreground">
        ※ 同じ曜日に複数行を追加すると、昼休みなどの分割営業になります。行を削除して保存すると、その曜日は定休になります。
      </p>
      <div className="pt-1">
        <Button type="submit" disabled={isSubmitting}>保存</Button>
      </div>
    </form>
  );
}
