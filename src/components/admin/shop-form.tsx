'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { shopCreateSchema, type ShopCreateInput } from '@/lib/validation/admin';
import { createShopAction } from '@/server/actions/admin-actions';
import { selectShopAction } from '@/server/auth/actions';
import { Input } from '@/components/ui/input';
import { Field, FormError, SubmitBar } from './form-kit';

export function ShopForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ShopCreateInput>({
    resolver: zodResolver(shopCreateSchema),
    defaultValues: { timezone: 'Asia/Tokyo' },
  });

  const onSubmit = async (data: ShopCreateInput) => {
    setServerError(null);
    const res = await createShopAction(data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    // 作成した店舗を選択中にして管理画面へ
    if (res.data?.id) await selectShopAction(res.data.id);
    router.push('/admin');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-lg gap-4">
      <FormError message={serverError} />
      <Field label="店舗名" required error={errors.name?.message}>
        <Input {...register('name')} placeholder="渋谷2号店" />
      </Field>
      <Field label="店舗slug" required error={errors.slug?.message} hint="公開予約URL: /book/{slug}（英小文字・数字・ハイフン）">
        <Input {...register('slug')} placeholder="shibuya-2" />
      </Field>
      <p className="text-xs text-muted-foreground">
        作成後は「下書き」状態です。メニュー・スタッフを登録し、店舗設定で公開すると予約を受け付けられます。
      </p>
      <SubmitBar submitting={isSubmitting} submitLabel="店舗を作成" onCancel={() => router.push('/admin')} />
    </form>
  );
}
