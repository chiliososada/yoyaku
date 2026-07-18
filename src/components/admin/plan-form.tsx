'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { planFormSchema, type PlanFormInput } from '@/lib/validation/platform';
import { updatePlanAction } from '@/server/actions/platform-actions';
import { Input } from '@/components/ui/input';
import { Field, CheckboxRow, FormError, SubmitBar } from './form-kit';

export function PlanForm({ planId, initial }: { planId: string; initial: PlanFormInput }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PlanFormInput>({
    resolver: zodResolver(planFormSchema),
    defaultValues: initial,
  });

  const onSubmit = async (data: PlanFormInput) => {
    setServerError(null);
    const res = await updatePlanAction(planId, data);
    if (!res.ok) { setServerError(res.error); return; }
    router.push('/platform/plans');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-xl gap-4">
      <FormError message={serverError} />
      <Field label="プラン名" required error={errors.name?.message}>
        <Input {...register('name')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="月額(円)" error={errors.priceJpy?.message}>
          <Input type="number" min={0} {...register('priceJpy')} />
        </Field>
        <Field label="店舗上限" error={errors.maxShops?.message}>
          <Input type="number" min={1} {...register('maxShops')} />
        </Field>
        <Field label="スタッフ/店舗" error={errors.maxStaffPerShop?.message}>
          <Input type="number" min={1} {...register('maxStaffPerShop')} />
        </Field>
        <Field label="予約/月" error={errors.maxBookingsPerMonth?.message}>
          <Input type="number" min={1} {...register('maxBookingsPerMonth')} />
        </Field>
      </div>
      <Field
        label="Stripe Price ID（オンライン申込用・任意）"
        error={errors.stripePriceId?.message}
      >
        <Input {...register('stripePriceId')} placeholder="price_XXXXXXXXXXXX" />
      </Field>
      <p className="-mt-2 text-xs text-muted-foreground">
        Stripe ダッシュボードで作成した月額サブスクの Price ID。設定したプランのみ商家がオンラインで申込できます。
      </p>
      <CheckboxRow label="有効" {...register('isActive')} />
      <SubmitBar submitting={isSubmitting} submitLabel="更新" onCancel={() => router.push('/platform/plans')} />
    </form>
  );
}
