'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, ExternalLink, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
  HP_BUSINESS_TYPES,
  HP_BUSINESS_TYPE_LABELS,
  shopHomepageSchema,
  type ShopHomepageInput,
} from '@/lib/validation/admin';
import { updateHomepageAction } from '@/server/actions/admin-actions';
import { useImageDrop, screenImageFiles } from './use-image-drop';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Field, Select, TextArea, CheckboxRow, FormError, SubmitBar } from './form-kit';

const DEFAULT_BRAND = '#4f46e5';

async function uploadImage(file: File, kind: 'hero' | 'logo' | 'gallery', shopId: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  fd.append('shopId', shopId);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd });
  const json = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!res.ok || !json.key) throw new Error(json.error || '画像のアップロードに失敗しました。');
  return json.key;
}

export function HomepageForm({
  shopId,
  slug,
  publicUrl,
  shopPublished,
  bookingEnabled,
  initial,
}: {
  shopId: string;
  slug: string;
  publicUrl: string;
  shopPublished: boolean;
  bookingEnabled: boolean;
  initial: ShopHomepageInput;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ShopHomepageInput>({
    resolver: zodResolver(shopHomepageSchema),
    defaultValues: initial,
  });

  const heroKey = watch('heroImageKey');
  const logoKey = watch('logoImageKey');
  const gallery = watch('gallery') ?? [];
  const themeColor = watch('themeColor') || '';
  const enabled = watch('homepageEnabled');

  const onSubmit = async (data: ShopHomepageInput) => {
    setServerError(null);
    setSaved(false);
    const res = await updateHomepageAction(shopId, data);
    if (!res.ok) {
      setServerError(res.error);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* noop */
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-3xl gap-6">
      <FormError message={serverError} />
      {saved && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <Check className="size-4" /> 保存しました。
        </div>
      )}

      {/* 公開URL & 状態 */}
      <div className="rounded-xl border bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">あなたのホームページURL</div>
            <div className="mt-0.5 truncate font-mono text-sm text-slate-800">{publicUrl}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              {copied ? <Check className="size-4 text-green-600" /> : <Copy className="size-4" />}
              {copied ? 'コピー済み' : 'URLをコピー'}
            </button>
            {/* 未公開のうちは /{slug} が 404 になるため、下書き用のプレビュー画面へ送る */}
            <a
              href={shopPublished && initial.homepageEnabled ? `/${slug}` : '/admin/homepage/preview'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-2 text-sm hover:bg-slate-50"
            >
              <ExternalLink className="size-4" /> プレビュー
            </a>
          </div>
        </div>
        <div className="mt-3">
          <CheckboxRow
            label="このホームページを公開する"
            hint="ONにすると検索エンジンに表示可能になります。"
            {...register('homepageEnabled')}
          />
        </div>
        {enabled && !shopPublished && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            公開するには「店舗設定」で店舗の公開状態を<strong>「公開」</strong>にする必要があります（現在は非公開）。
          </p>
        )}
        {/* ホームページはONでもネット予約がOFFだと、予約ボタンの無いHPが公開される。
            検索から来た客は予約手段が見つからず離脱するが、店主の画面には何も出ない。 */}
        {enabled && shopPublished && !bookingEnabled && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            「ネット予約」が<strong>停止中</strong>のため、ホームページに予約ボタンが表示されません。
            紹介ページとして使う場合はこのままで構いません。予約も受け付ける場合は「店舗設定」で
            ネット予約をONにしてください。
          </p>
        )}
      </div>

      {/* 基本 */}
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-bold text-slate-700">基本情報</legend>
        <Field label="キャッチコピー" error={errors.tagline?.message} hint="トップの見出し下に大きく表示（例: 髪から、あなたらしく。）">
          <Input {...register('tagline')} maxLength={80} placeholder="髪から、あなたらしく。" />
        </Field>
        <Field label="紹介文" error={errors.about?.message} hint="改行OK。お店のこだわり・雰囲気など。">
          <TextArea rows={6} {...register('about')} placeholder="当店は…" />
        </Field>
        <Field label="業種（検索表示用）" error={errors.businessType?.message}>
          <Select {...register('businessType')}>
            {HP_BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {HP_BUSINESS_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="アクセス補足" error={errors.accessNote?.message} hint="最寄駅・駐車場など（住所・電話は「店舗設定」から）">
          <Input {...register('accessNote')} placeholder="◯◯駅 徒歩3分／提携駐車場あり" />
        </Field>
        <Field label="テーマカラー" error={errors.themeColor?.message} hint="ボタンや見出しの色。未指定はブランド標準色。">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={themeColor || DEFAULT_BRAND}
              onChange={(e) => setValue('themeColor', e.target.value, { shouldDirty: true })}
              className="size-10 cursor-pointer rounded border"
              aria-label="テーマカラー"
            />
            <Input
              value={themeColor}
              onChange={(e) => setValue('themeColor', e.target.value, { shouldDirty: true })}
              placeholder={DEFAULT_BRAND}
              className="w-32 font-mono"
            />
            {themeColor && (
              <button
                type="button"
                onClick={() => setValue('themeColor', '', { shouldDirty: true })}
                className="text-xs text-muted-foreground hover:underline"
              >
                標準に戻す
              </button>
            )}
          </div>
        </Field>
      </fieldset>

      {/* 画像 */}
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-bold text-slate-700">画像</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SingleImage
            label="メイン画像（ヒーロー）"
            hint="トップの大きな背景。横長（16:9・1600×900px 前後）がおすすめ。中央を基準に表示枠へ切り抜かれるため、文字入りの画像は端が切れることがあります。"
            shopId={shopId}
            kind="hero"
            value={heroKey || ''}
            onChange={(k) => setValue('heroImageKey', k, { shouldDirty: true })}
            aspect="aspect-video"
          />
          <SingleImage
            label="ロゴ"
            hint="ヘッダーに表示。正方形（512×512px 前後）・背景透過のPNGがおすすめ。"
            shopId={shopId}
            kind="logo"
            value={logoKey || ''}
            onChange={(k) => setValue('logoImageKey', k, { shouldDirty: true })}
            aspect="aspect-square"
          />
        </div>
        <GalleryImages
          shopId={shopId}
          value={gallery}
          onChange={(next) => setValue('gallery', next, { shouldDirty: true })}
        />
      </fieldset>

      {/* SNS */}
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-bold text-slate-700">SNS・リンク</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Instagram URL" error={errors.instagramUrl?.message}>
            <Input {...register('instagramUrl')} placeholder="https://instagram.com/…" />
          </Field>
          <Field label="LINE 公式 URL" error={errors.lineUrl?.message}>
            <Input {...register('lineUrl')} placeholder="https://lin.ee/…" />
          </Field>
          <Field label="X (旧Twitter) URL" error={errors.xUrl?.message}>
            <Input {...register('xUrl')} placeholder="https://x.com/…" />
          </Field>
          <Field label="ウェブサイト URL" error={errors.websiteUrl?.message}>
            <Input {...register('websiteUrl')} placeholder="https://…" />
          </Field>
        </div>
      </fieldset>

      {/* 表示セクション */}
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-bold text-slate-700">表示するセクション</legend>
        <div className="flex flex-wrap gap-6">
          <CheckboxRow label="メニュー・料金" {...register('showMenu')} />
          <CheckboxRow label="スタッフ紹介" {...register('showStaff')} />
          <CheckboxRow label="ギャラリー" {...register('showGallery')} />
          <CheckboxRow
            label="住所を表示する"
            hint="自宅サロン等はOFFに（地図・検索データからも非表示になります）"
            {...register('showAddress')}
          />
        </div>
      </fieldset>

      {/* SEO */}
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-bold text-slate-700">SEO（任意・未入力なら自動生成）</legend>
        <Field label="ページタイトル" error={errors.seoTitle?.message} hint="検索結果の見出し（70字以内）">
          <Input {...register('seoTitle')} maxLength={70} />
        </Field>
        <Field label="ページ説明" error={errors.seoDescription?.message} hint="検索結果の説明文（160字以内）">
          <TextArea rows={2} {...register('seoDescription')} maxLength={160} />
        </Field>
      </fieldset>

      <SubmitBar submitting={isSubmitting} submitLabel="保存する" />
    </form>
  );
}

function SingleImage({
  label,
  hint,
  shopId,
  kind,
  value,
  onChange,
  aspect,
}: {
  label: string;
  hint?: string;
  shopId: string;
  kind: 'hero' | 'logo';
  value: string;
  onChange: (key: string) => void;
  aspect: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** 選択・ドロップ共通の取り込み処理。 */
  const accept = async (files: File[]) => {
    const { accepted, error } = screenImageFiles(files);
    setErr(error);
    const file = accepted[0];
    if (!file) return;
    if (accepted.length > 1) {
      // 1枚しか使わないので、黙って捨てずに何が採用されたか伝える
      setErr(`複数選ばれたため、最初の1枚（${file.name}）を使用します。`);
    }
    setBusy(true);
    try {
      onChange(await uploadImage(file, kind, shopId));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'アップロードに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await accept(files);
  };

  const { over, handlers } = useImageDrop((files) => void accept(files), busy);

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {/* 枠ごとドロップ領域。クリックでもファイル選択できるよう label で包む。 */}
      <label
        {...handlers}
        className={cn(
          'relative block cursor-pointer overflow-hidden rounded-xl border bg-slate-50 transition-colors',
          aspect,
          over && 'border-2 border-dashed border-primary bg-primary/5',
        )}
      >
        <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/uploads/${value}`} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-slate-400">
            <ImagePlus className="size-8" />
            <span className="px-4 text-center text-xs">
              ここに画像をドラッグ＆ドロップ
              <br />
              またはクリックして選択
            </span>
          </div>
        )}
        {over && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary/10">
            <span className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
              ここにドロップ
            </span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <Loader2 className="size-6 animate-spin text-slate-500" />
          </div>
        )}
      </label>
      <div className="flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
          <ImagePlus className="size-4" /> {value ? '画像を変更' : '画像を選ぶ'}
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange('')} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
            <Trash2 className="size-3.5" /> 削除
          </button>
        )}
      </div>
      {hint && !err && <p className="text-xs text-muted-foreground">{hint}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}

function GalleryImages({
  shopId,
  value,
  onChange,
}: {
  shopId: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const MAX = 12;

  const remaining = MAX - value.length;

  /** 選択・ドロップ共通。上限超過は黙って切り捨てず件数を伝える。 */
  const accept = async (files: File[]) => {
    const { accepted, error } = screenImageFiles(files);
    const notices: string[] = error ? [error] : [];
    const use = accepted.slice(0, Math.max(0, remaining));
    if (accepted.length > use.length) {
      notices.push(`上限${MAX}枚のため、${accepted.length - use.length}枚は追加していません。`);
    }
    setErr(notices.length > 0 ? notices.join(' / ') : null);
    if (use.length === 0) return;
    setBusy(true);
    try {
      const keys: string[] = [];
      for (const f of use) keys.push(await uploadImage(f, 'gallery', shopId));
      onChange([...value, ...keys].slice(0, MAX));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'アップロードに失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) await accept(files);
  };

  const { over, handlers } = useImageDrop((files) => void accept(files), busy || remaining <= 0);

  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">ギャラリー（最大{MAX}枚）</span>
      <div
        {...handlers}
        className={cn(
          'grid grid-cols-3 gap-2 rounded-lg p-1 transition-colors sm:grid-cols-4',
          over && 'bg-primary/5 ring-2 ring-dashed ring-primary',
        )}
      >
        {value.map((key) => (
          <div key={key} className="group relative aspect-square overflow-hidden rounded-lg border bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/uploads/${key}`} alt="ギャラリー" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((k) => k !== key))}
              className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="削除"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {remaining > 0 && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-white p-2 text-center text-slate-400 hover:bg-slate-50">
            {busy ? <Loader2 className="size-6 animate-spin" /> : <ImagePlus className="size-6" />}
            <span className="text-[10px] leading-tight">ドラッグ＆ドロップ<br />または選択</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={onFiles} disabled={busy} />
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {remaining > 0
          ? `まとめてドロップできます（あと${remaining}枚）。`
          : `上限の${MAX}枚に達しています。追加するには、いずれかを削除してください。`}
      </p>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
