'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Loader2, MapPin, Undo2 } from 'lucide-react';
import { shopSettingsSchema, type ShopSettingsInput } from '@/lib/validation/admin';
import { updateShopSettingsAction } from '@/server/actions/admin-actions';
import { Input } from '@/components/ui/input';
import { normalizePostalCode, formatPostalCode } from '@/lib/postal';
import { Field, Select, TextArea, CheckboxRow, FormError, SubmitBar } from './form-kit';

export function ShopSettingsForm({ shopId, initial }: { shopId: string; initial: ShopSettingsInput }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ShopSettingsInput>({
    resolver: zodResolver(shopSettingsSchema),
    defaultValues: initial,
  });

  // ---- 郵便番号から住所を自動入力 ----
  const [lookup, setLookup] = useState<{ busy: boolean; note: string | null; error: string | null }>({
    busy: false,
    note: null,
    error: null,
  });
  /** 自動入力の直前の値。取り消せないと、手入力を消された店主が困る。 */
  const beforeFill = useRef<{ prefecture: string; city: string; address: string } | null>(null);
  /** 同じ番号を何度も引かない＋古い応答が後から上書きするのを防ぐ。 */
  const lastCode = useRef<string | null>(null);

  const applyPostal = async (raw: string, force = false) => {
    const code = normalizePostalCode(raw);
    if (!code) {
      // ボタンから明示的に押されたときだけ、桁数不足を伝える
      // （入力途中の毎打鍵で赤字を出さない）
      if (force) setLookup({ busy: false, note: null, error: '郵便番号を7桁で入力してください。' });
      return;
    }
    // 自動実行は「番号が変わったとき」だけ。ただしボタンは何度でも効く
    // （保存済みの番号を開き直した場合、値が変わらないので自動では動かない）。
    if (!force && code === lastCode.current) return;
    lastCode.current = code;
    setLookup({ busy: true, note: null, error: null });
    try {
      const res = await fetch(`/api/postal?code=${code}`);
      const json = (await res.json()) as { address?: { prefecture: string; city: string; town: string }; error?: string };
      if (!res.ok || !json.address) {
        setLookup({ busy: false, note: null, error: json.error ?? '住所を取得できませんでした。' });
        return;
      }
      // 取り消せるように直前の値を控える
      beforeFill.current = {
        prefecture: getValues('prefecture') ?? '',
        city: getValues('city') ?? '',
        address: getValues('address') ?? '',
      };
      const { prefecture, city, town } = json.address;
      setValue('prefecture', prefecture, { shouldDirty: true });
      setValue('city', city, { shouldDirty: true });
      // 番地・建物は店主が入力する欄。町域を入れるのは空のときだけにして、
      // 入力済みの番地を消さない（消すと気づかないまま保存され、住所が壊れる）。
      const current = (getValues('address') ?? '').trim();
      if (current === '' && town) setValue('address', town, { shouldDirty: true });
      setLookup({
        busy: false,
        error: null,
        note: `${formatPostalCode(code)} → ${prefecture} ${city}${town ? ` ${town}` : ''} を入力しました。`,
      });
    } catch {
      setLookup({ busy: false, note: null, error: '住所の自動入力に失敗しました。直接ご入力ください。' });
    }
  };

  const undoFill = () => {
    const b = beforeFill.current;
    if (!b) return;
    setValue('prefecture', b.prefecture, { shouldDirty: true });
    setValue('city', b.city, { shouldDirty: true });
    setValue('address', b.address, { shouldDirty: true });
    beforeFill.current = null;
    lastCode.current = null;
    setLookup({ busy: false, note: null, error: null });
  };

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
        <Field
          label="メール（店舗の連絡先）"
          error={errors.email?.message}
          hint="控えとして保存するだけの項目です。予約の通知先は「通知設定」で登録してください。"
        >
          <Input type="email" {...register('email')} />
        </Field>
      </div>
      {/* 郵便番号は入力欄＋ボタンを横に並べるため独立した行にする。
          4分割の中に押し込むと、入力欄が7桁を表示しきれない幅になっていた。 */}
      <Field
        label="郵便番号"
        htmlFor="postalCode"
        error={errors.postalCode?.message}
        hint="ハイフンなしで入力（例: 1500002）"
      >
        <div className="flex items-center gap-2">
          <Input
            id="postalCode"
            {...register('postalCode', {
              // 7桁そろった時点で自動で引く（入力途中では動かない）。
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => void applyPostal(e.target.value),
            })}
            placeholder="1500002"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={8}
            className="w-40 tabular-nums"
          />
          {/*
            ボタンを必ず置く。自動実行は「値が変わったとき」しか動かないため、
            保存済みの郵便番号を開き直した場合は何も起きず、
            店主からは「入っているのに出ない」＝壊れているように見える。
          */}
          <button
            type="button"
            onClick={() => void applyPostal(getValues('postalCode') ?? '', true)}
            disabled={lookup.busy}
            title="郵便番号から住所を入力"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            {lookup.busy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
            住所入力
          </button>
        </div>
      </Field>

      {/* 番地は「1-2-3 ◯◯ビル4F」まで入るので他より広く取る */}
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1.4fr]">
        <Field label="都道府県" error={errors.prefecture?.message}>
          <Input {...register('prefecture')} placeholder="東京都" />
        </Field>
        <Field label="市区町村" error={errors.city?.message}>
          <Input {...register('city')} placeholder="港区" />
        </Field>
        <Field label="番地・建物" error={errors.address?.message}>
          <Input {...register('address')} placeholder="新橋1-2-3 ◯◯ビル4F" />
        </Field>
      </div>

      {/* 自動入力の結果。何を入れたのかを示し、取り消せるようにする
          （黙って書き換わると、手入力した住所が消えたことに気づけない）。 */}
      {lookup.note && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <MapPin className="size-3.5 shrink-0" />
          <span>{lookup.note}</span>
          {beforeFill.current && (
            <button type="button" onClick={undoFill} className="inline-flex items-center gap-1 font-medium underline">
              <Undo2 className="size-3" /> 元に戻す
            </button>
          )}
        </p>
      )}
      {lookup.error && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {lookup.error}
        </p>
      )}
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
