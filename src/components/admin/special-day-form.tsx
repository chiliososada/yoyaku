'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { Plus, AlertTriangle, Info } from 'lucide-react';
import { type SpecialDayInput } from '@/lib/validation/admin';
import { addSpecialDayAction } from '@/server/actions/admin-actions';
import { jpHolidayName } from '@/lib/jp-holidays';
import { SPECIAL_DAY_PRESETS, findPreset, type SpecialDayPresetValue } from '@/lib/special-day-presets';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, Select, FormError } from './form-kit';
import { hhmmToMinutes } from '@/lib/time';

/** フォームが扱う形。区分は「プリセット」で、保存時に type + 理由へ展開する。 */
interface FormShape {
  date: string;
  preset: SpecialDayPresetValue;
  reason: string;
  open: string;
  close: string;
}

export function SpecialDayForm({
  shopId,
  closeOnNationalHolidays,
}: {
  shopId: string;
  /** 店舗設定の「祝日休業」。ONなら祝日は自動で休みなので、個別登録は不要と伝える。 */
  closeOnNationalHolidays: boolean;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormShape>({
    defaultValues: { preset: 'CLOSED', reason: '', date: '', open: '10:00', close: '18:00' },
  });

  const presetValue = watch('preset');
  const preset = findPreset(presetValue);
  const date = watch('date');
  const holidayName = date ? jpHolidayName(date) : null;

  /** 区分を変えたら理由の既定値を入れ替える（自由入力した内容は消さない）。 */
  const onPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = findPreset(e.target.value);
    const prev = findPreset(presetValue);
    const current = watch('reason');
    // 直前のプリセット既定値のまま（＝手入力していない）なら差し替える
    if (current === '' || current === prev.defaultReason) {
      setValue('reason', next.defaultReason);
    }
  };

  const onSubmit = async (data: FormShape) => {
    setServerError(null);
    setNotice(null);
    const p = findPreset(data.preset);
    const payload: SpecialDayInput = {
      date: data.date,
      type: p.type,
      reason: data.reason,
      ...(p.needsHours
        ? { openMinute: hhmmToMinutes(data.open), closeMinute: hhmmToMinutes(data.close) }
        : {}),
    };
    const res = await addSpecialDayAction(shopId, payload);
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
    } else if (res.data?.noStaffOnDuty) {
      // スタッフのシフトは曜日ごとの設定。営業日を足しても、その曜日が休みのままなら
      // 出勤者ゼロ＝客の予約画面は全時間帯「×」になる。店主からは原因が見えない。
      setNotice(
        'この日は出勤予定のスタッフがいないため、このままではお客様の予約画面に空き時間が表示されません。' +
          '「スタッフ」→ 対象スタッフの「シフト」から、この日の勤務時間を追加してください。',
      );
    }
    reset({ preset: 'CLOSED', reason: '', date: '', open: '10:00', close: '18:00' });
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
        <Field
          label="日付"
          required
          error={errors.date?.message}
          hint={holidayName ? `この日は「${holidayName}」です。` : undefined}
        >
          <Input type="date" {...register('date')} />
        </Field>
        <Field label="区分">
          <Select {...register('preset', { onChange: onPresetChange })}>
            {SPECIAL_DAY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* 区分ごとの補足。放っておくと「登録したのに効かない」「毎週分を手で足す」を招く。 */}
      {presetValue === 'HOLIDAY' && closeOnNationalHolidays && (
        <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            店舗設定で「祝日は休業」がONになっているため、祝日は自動で休業になります。
            この登録は不要です（お客様への表示を明示したい場合のみお使いください）。
          </span>
        </p>
      )}
      {presetValue === 'REGULAR' && (
        <p className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            ここで登録できるのは<strong>この日1日だけ</strong>です。毎週の定休日は
            <Link href="/admin/business-hours" className="mx-0.5 font-medium underline">
              営業時間
            </Link>
            でその曜日を削除して設定してください（毎週分をここに足す必要はありません）。
          </span>
        </p>
      )}

      {preset.needsHours && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="開店">
            <Input type="time" {...register('open')} />
          </Field>
          <Field label="閉店">
            <Input type="time" {...register('close')} />
          </Field>
        </div>
      )}

      <Field
        label="理由（任意）"
        error={errors.reason?.message}
        hint="お客様のホームページの「お知らせ」にもこの文言が表示されます。"
      >
        <Input {...register('reason')} placeholder="研修のため 等" />
      </Field>
      <Button type="submit" disabled={isSubmitting} className="w-fit">
        <Plus className="size-4" /> 追加
      </Button>
    </form>
  );
}
