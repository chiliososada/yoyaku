'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check } from 'lucide-react';
import { shopSettingsSchema, type ShopSettingsInput } from '@/lib/validation/admin';
import { updateShopSettingsAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Field, Select, TextArea, CheckboxRow, FormError, SubmitBar } from './form-kit';

export function ShopSettingsForm({ shopId, initial }: { shopId: string; initial: ShopSettingsInput }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ShopSettingsInput>({
    resolver: zodResolver(shopSettingsSchema),
    defaultValues: initial,
  });

  const onSubmit = async (data: ShopSettingsInput) => {
    setServerError(null);
    setSaved(false);
    const res = await updateShopSettingsAction(shopId, data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-4">
      <FormError message={serverError} />
      {saved && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <Check className="size-4" /> 保存しました。
        </div>
      )}
      <Field label="店舗名" required error={errors.name?.message}>
        <Input {...register('name')} />
      </Field>
      <Field label="店舗紹介" error={errors.description?.message}>
        <TextArea {...register('description')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="電話" error={errors.phone?.message}>
          <Input {...register('phone')} />
        </Field>
        <Field label="メール" error={errors.email?.message}>
          <Input type="email" {...register('email')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="郵便番号" error={errors.postalCode?.message}>
          <Input {...register('postalCode')} placeholder="150-0002" />
        </Field>
        <Field label="都道府県" error={errors.prefecture?.message}>
          <Input {...register('prefecture')} placeholder="東京都" />
        </Field>
        <Field label="市区町村" error={errors.city?.message}>
          <Input {...register('city')} placeholder="渋谷区" />
        </Field>
        <Field label="番地・建物" error={errors.address?.message}>
          <Input {...register('address')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="公開状態" error={errors.status?.message}>
          <Select {...register('status')}>
            <option value="DRAFT">下書き</option>
            <option value="PUBLISHED">公開</option>
            <option value="CLOSED">休止</option>
          </Select>
        </Field>
        <Field label="店舗同時受付上限" error={errors.shopCapacity?.message} hint="同一時間帯に店舗全体で受けられる予約数">
          <Input type="number" min={1} {...register('shopCapacity')} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <CheckboxRow label="オンライン予約を受け付ける" {...register('publicBookingEnabled')} />
        <CheckboxRow label="祝日は休業する" {...register('closeOnNationalHolidays')} />
      </div>
      <SubmitBar submitting={isSubmitting} submitLabel="保存" />
    </form>
  );
}
