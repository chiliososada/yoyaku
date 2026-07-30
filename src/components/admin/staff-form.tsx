'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { staffFormSchema, type StaffFormInput } from '@/lib/validation/admin';
import { createStaffAction, updateStaffAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { Field, Select, TextArea, CheckboxRow, CheckboxGroup, FormError, SubmitBar } from './form-kit';

export function StaffForm({
  shopId,
  services,
  staffId,
  initial,
}: {
  shopId: string;
  services: { id: string; name: string }[];
  staffId?: string;
  initial?: Partial<StaffFormInput>;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffFormInput>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      displayName: initial?.displayName ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
      bio: initial?.bio ?? '',
      isBookable: initial?.isBookable ?? true,
      capacity: initial?.capacity ?? 1,
      nominationFeeJpy: initial?.nominationFeeJpy ?? 0,
      status: initial?.status ?? 'ACTIVE',
      sortOrder: initial?.sortOrder ?? 0,
      serviceIds: initial?.serviceIds ?? [],
    },
  });

  const onSubmit = async (data: StaffFormInput) => {
    setServerError(null);
    const res = staffId
      ? await updateStaffAction(staffId, shopId, data)
      : await createStaffAction(shopId, data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    router.push('/admin/staff');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-4">
      <FormError message={serverError} />
      <Field label="氏名" required error={errors.name?.message}>
        <Input {...register('name')} placeholder="山田 太郎" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="表示名" error={errors.displayName?.message} hint="顧客向けの表示名（任意）">
          <Input {...register('displayName')} placeholder="山田" />
        </Field>
        {/*
          「同時対応数」は入力欄を出さない。
          booking_items の GiST 排他制約
            EXCLUDE USING gist (staffId WITH =, tstzrange(startAt,endAt) WITH &&)
          が「同一スタッフの時間重複」を物理的に禁止しており、排他制約は
          「最大N件まで許す」を表現できない。よって2以上を設定できるようにすると
          「空きあり」と表示されたのに確定時にDBエラー、という最悪の形になる。
          （実測: capacity=2 にしても2件目の挿入が制約違反で失敗した）
          1人が同時に複数名を見る運用に対応するなら、排他制約を容量認識型の仕組みへ
          置き換える設計変更が必要で、それは防超卖の根幹に触れるため別途判断する。
          値は schema 既定の 1 のまま送る。
        */}
        <input type="hidden" {...register('capacity')} />
        <Field label="同時対応数" hint="現在は1名ずつの対応のみに対応しています。">
          <Input type="number" value={1} disabled readOnly />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="メール" error={errors.email?.message}>
          <Input type="email" {...register('email')} />
        </Field>
        <Field label="電話" error={errors.phone?.message}>
          <Input {...register('phone')} />
        </Field>
      </div>
      <Field
        label="指名料（円）"
        error={errors.nominationFeeJpy?.message}
        hint="顧客がこのスタッフを指名した場合に合計へ加算されます（0 = 無料指名）"
      >
        <Input type="number" min={0} step={100} {...register('nominationFeeJpy')} />
      </Field>
      <Field label="紹介文" error={errors.bio?.message}>
        <TextArea {...register('bio')} placeholder="スタイリスト歴..." />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="状態" error={errors.status?.message}>
          <Select {...register('status')}>
            <option value="ACTIVE">稼働中</option>
            <option value="INACTIVE">停止中</option>
          </Select>
        </Field>
        <Field label="表示順" error={errors.sortOrder?.message}>
          <Input type="number" min={0} {...register('sortOrder')} />
        </Field>
      </div>
      <CheckboxRow label="指名予約を受け付ける" hint="顧客が指名できるようにする" {...register('isBookable')} />

      <Field label="担当できるメニュー" error={errors.serviceIds?.message}>
        <Controller
          control={control}
          name="serviceIds"
          render={({ field }) => (
            <CheckboxGroup options={services} value={field.value ?? []} onChange={field.onChange} empty="メニューがありません。" />
          )}
        />
      </Field>

      <SubmitBar submitting={isSubmitting} submitLabel={staffId ? '更新' : '登録'} onCancel={() => router.push('/admin/staff')} />
    </form>
  );
}
