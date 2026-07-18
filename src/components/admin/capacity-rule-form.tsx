'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { capacityRuleSchema, type CapacityRuleInput } from '@/lib/validation/admin';
import { updateCapacityRuleAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FormError } from './form-kit';

export function CapacityRuleForm({
  ruleId,
  shopId,
  label,
  initial,
}: {
  ruleId: string;
  shopId: string;
  label: string;
  initial: CapacityRuleInput;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CapacityRuleInput>({
    resolver: zodResolver(capacityRuleSchema),
    defaultValues: initial,
  });

  const onSubmit = async (data: CapacityRuleInput) => {
    setServerError(null);
    setSaved(false);
    const res = await updateCapacityRuleAction(ruleId, shopId, data);
    if (!res.ok) { setServerError(res.error); return; }
    setSaved(true);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium">{label}</h3>
        {saved && <span className="flex items-center gap-1 text-xs text-green-600"><Check className="size-3.5" /> 保存済み</span>}
      </div>
      <FormError message={serverError} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="同時受付数" error={errors.maxConcurrent?.message}>
          <Input type="number" min={1} {...register('maxConcurrent')} />
        </Field>
        <Field label="予約刻み(分)" error={errors.slotIntervalMin?.message}>
          <Input type="number" min={5} step={5} {...register('slotIntervalMin')} />
        </Field>
        <Field label="受付(日前から)" error={errors.bookingWindowDays?.message}>
          <Input type="number" min={0} {...register('bookingWindowDays')} />
        </Field>
        <Field label="締切(時間前)" error={errors.leadTimeMinHours?.message}>
          <Input type="number" min={0} {...register('leadTimeMinHours')} />
        </Field>
        <Field label="ｷｬﾝｾﾙ期限(時間前)" error={errors.cancellationDeadlineHours?.message}>
          <Input type="number" min={0} {...register('cancellationDeadlineHours')} />
        </Field>
      </div>
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={isSubmitting}>保存</Button>
      </div>
    </form>
  );
}
