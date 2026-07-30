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
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<CapacityRuleInput>({
    resolver: zodResolver(capacityRuleSchema),
    defaultValues: initial,
  });

  // 締切とキャンセル期限は単体では妥当でも、組合せで「客が自分でキャンセルできない予約」を生む。
  // 例: 締切2時間前 + キャンセル期限24時間前 → 24時間以内に入った予約は最初から
  // キャンセル不可（客は確認メールのリンクを開いても操作できず、店に電話が来る）。
  // 禁止すべき設定ではない（当日枠を守りたい店は正当）ため、エラーではなく注意書きで知らせる。
  const lead = Number(watch('leadTimeMinHours'));
  const cancelDl = Number(watch('cancellationDeadlineHours'));
  const cancelGap =
    Number.isFinite(lead) && Number.isFinite(cancelDl) && cancelDl > lead ? cancelDl : null;

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
        <Field
          label="予約刻み(分)"
          error={errors.slotIntervalMin?.message}
          hint="メニューごとの「予約刻み」が優先されます。実際の刻みは各メニューの設定をご確認ください。"
        >
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
      {cancelGap !== null && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ご注意: 開始{cancelGap}時間前より後に入った予約は、お客様ご自身ではキャンセルできません
          （受付の締切が{lead}時間前のため、この時間帯の予約は最初から期限切れの状態になります）。
          該当のお客様には「店舗へご連絡ください」と案内され、電話等での対応が必要になります。
          この運用で問題なければそのままで構いません。
        </p>
      )}
      <div className="mt-3">
        <Button type="submit" size="sm" disabled={isSubmitting}>保存</Button>
      </div>
    </form>
  );
}
