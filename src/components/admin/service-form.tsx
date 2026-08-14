'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Plus, UserPlus, X } from 'lucide-react';
import { serviceFormSchema, type ServiceFormInput } from '@/lib/validation/admin';
import { createServiceAction, updateServiceAction } from '@/server/actions/admin-actions';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { ColorPicker } from '@/components/ui/color-picker';
import { Button } from '@/components/ui/button';
import { Field, Select, TextArea, CheckboxRow, CheckboxGroup, FormError, SubmitBar } from './form-kit';

export function ServiceForm({
  shopId,
  staff,
  serviceId,
  initial,
}: {
  shopId: string;
  staff: { id: string; name: string }[];
  serviceId?: string;
  initial?: Partial<ServiceFormInput>;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  /** スタッフが居るのに選び忘れたときだけ出す（居ない段階では出さない）。 */
  const [staffError, setStaffError] = useState<string | null>(null);
  const noStaffYet = staff.length === 0;
  const {
    register,
    control,
    watch,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormInput>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      category: initial?.category ?? '',
      description: initial?.description ?? '',
      durationMin: initial?.durationMin ?? 60,
      bufferAfterMin: initial?.bufferAfterMin ?? 0,
      priceJpy: initial?.priceJpy ?? 0,
      salePriceJpy: initial?.salePriceJpy ?? null,
      capacity: initial?.capacity ?? 1,
      requiresStaff: initial?.requiresStaff ?? true,
      slotIntervalMin: initial?.slotIntervalMin ?? 15,
      color: initial?.color ?? '',
      isActive: initial?.isActive ?? true,
      sortOrder: initial?.sortOrder ?? 0,
      staffIds: initial?.staffIds ?? [],
      segments: initial?.segments ?? [],
      options: initial?.options ?? [],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'segments' });
  const {
    fields: optFields,
    append: optAppend,
    remove: optRemove,
  } = useFieldArray({ control, name: 'options' });

  const requiresStaff = watch('requiresStaff');
  const staffIds = watch('staffIds') ?? [];

  const onSubmit = async (data: ServiceFormInput) => {
    setServerError(null);
    setStaffError(null);
    // スタッフが居るのに0名選択は入力ミス。サーバーまで往復させずここで止める。
    // 逆にスタッフが1人も居ない開店準備中は、保存できないと先に進めないので通す。
    if (!noStaffYet && data.requiresStaff && (data.staffIds ?? []).length === 0) {
      setStaffError('担当スタッフを1名以上選択してください。担当が不要なメニューなら「担当スタッフが必要」のチェックを外してください。');
      return;
    }
    const res = serviceId
      ? await updateServiceAction(serviceId, shopId, data)
      : await createServiceAction(shopId, data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    router.push('/admin/services');
    router.refresh();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-4">
      <FormError message={serverError} />
      <Field label="メニュー名" required error={errors.name?.message}>
        <Input {...register('name')} placeholder="カット" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="カテゴリ" error={errors.category?.message}>
          <Input {...register('category')} placeholder="ヘア" />
        </Field>
        <Field
          label="表示色"
          error={errors.color?.message}
          hint="予約画面のメニュー帯と、管理画面の一覧に使われます。"
        >
          <Controller
            control={control}
            name="color"
            render={({ field }) => (
              <ColorPicker
                value={field.value ?? ''}
                onChange={field.onChange}
                fallback="#2563eb"
                clearLabel="色なし"
              />
            )}
          />
        </Field>
      </div>
      <Field label="説明" error={errors.description?.message}>
        <TextArea {...register('description')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="所要時間(分)" required error={errors.durationMin?.message}>
          <Input type="number" min={1} {...register('durationMin')} />
        </Field>
        <Field label="後バッファ(分)" error={errors.bufferAfterMin?.message} hint="片付け等">
          <Input type="number" min={0} {...register('bufferAfterMin')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="通常料金(円)" error={errors.priceJpy?.message}>
          <Input type="number" min={0} {...register('priceJpy')} />
        </Field>
        <Field
          label="セール価格(円)"
          error={errors.salePriceJpy?.message}
          hint="任意。予約ページで通常料金に取り消し線＋割引表示"
        >
          <Input type="number" min={1} step={100} placeholder="割引時のみ入力" {...register('salePriceJpy')} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="同時受付数" error={errors.capacity?.message} hint="この枠で同時に受けられる数">
          <Input type="number" min={1} {...register('capacity')} />
        </Field>
        <Field label="予約刻み(分)" error={errors.slotIntervalMin?.message}>
          <Input type="number" min={5} step={5} {...register('slotIntervalMin')} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-6">
        <CheckboxRow label="担当スタッフが必要" {...register('requiresStaff')} />
        <CheckboxRow label="公開する" {...register('isActive')} />
      </div>

      <Field label="担当スタッフ" error={staffError ?? errors.staffIds?.message}>
        <Controller
          control={control}
          name="staffIds"
          render={({ field }) => (
            <CheckboxGroup options={staff} value={field.value ?? []} onChange={field.onChange} empty="スタッフがいません。" />
          )}
        />
      </Field>
      {/*
        スタッフ0名でも保存できる。ここで止めると、開店準備でメニューを先に作った店主が
        「1名以上選んでください」と言われたまま候補が無く、何をしても先へ進めなくなる。
        代わりに、この状態では予約を受けられないことと、次にやることを明示する。
      */}
      {noStaffYet && requiresStaff && (
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <div className="grid gap-1.5">
            <span>
              スタッフがまだ登録されていないため、このメニューは<strong>このまま保存できます</strong>が、
              お客様の予約ページには空き時間が表示されません（担当できる人がいないため）。
              スタッフを登録したあと、この画面で担当にチェックを入れてください。
            </span>
            <Link
              href="/admin/staff/new"
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-sky-300 bg-white px-2.5 py-1 font-medium text-sky-900 hover:bg-sky-100"
            >
              <UserPlus className="size-3.5" /> スタッフを登録する
            </Link>
          </div>
        </div>
      )}
      {!noStaffYet && requiresStaff && staffIds.length === 0 && !staffError && (
        <p className="text-xs text-muted-foreground">
          担当が不要なメニュー（物販など）は「担当スタッフが必要」のチェックを外してください。
        </p>
      )}

      <Field label="時間帯分割（任意）" hint="塗布→放置(空き)→仕上げ など、占有しない待ち時間がある場合に設定。未設定なら所要時間どおり連続占有。">
        <div className="grid gap-2">
          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">開始+</span>
              <Input type="number" min={0} className="w-24" {...register(`segments.${i}.offsetMin`)} placeholder="0" />
              <span className="text-xs text-muted-foreground">分 / 長さ</span>
              <Input type="number" min={1} className="w-24" {...register(`segments.${i}.durationMin`)} placeholder="30" />
              <span className="text-xs text-muted-foreground">分</span>
              <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => append({ offsetMin: 0, durationMin: 30 })}>
            <Plus className="size-4" /> 区間を追加
          </Button>
        </div>
      </Field>

      <Field
        label="オプション（追加メニュー）"
        hint="例: トリートメント追加 +¥1,500 / +15分。顧客は予約時に選択できます。"
      >
        <div className="grid gap-2">
          {optFields.map((f, i) => (
            <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <Input className="w-44 flex-1" {...register(`options.${i}.name`)} placeholder="オプション名" />
              <span className="text-xs text-muted-foreground">+¥</span>
              <Input type="number" min={0} step={100} className="w-24" {...register(`options.${i}.priceJpy`)} />
              <span className="text-xs text-muted-foreground">/ +</span>
              <Input type="number" min={0} step={5} className="w-20" {...register(`options.${i}.extraDurationMin`)} />
              <span className="text-xs text-muted-foreground">分</span>
              <Button type="button" variant="ghost" size="icon" onClick={() => optRemove(i)}>
                <X className="size-4" />
              </Button>
              {errors.options?.[i]?.name && (
                <p className="w-full text-xs text-destructive">{errors.options[i]?.name?.message}</p>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => optAppend({ name: '', priceJpy: 0, extraDurationMin: 0 })}
          >
            <Plus className="size-4" /> オプションを追加
          </Button>
        </div>
      </Field>

      <SubmitBar submitting={isSubmitting} submitLabel={serviceId ? '更新' : '登録'} onCancel={() => router.push('/admin/services')} />
    </form>
  );
}
