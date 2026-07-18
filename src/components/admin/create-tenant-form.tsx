'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import { createTenantSchema, type CreateTenantInput } from '@/lib/validation/platform';
import { createTenantAction } from '@/server/actions/platform-actions';
import { Input } from '@/components/ui/input';
import { Field, Select, FormError, SubmitBar } from './form-kit';

type Created = { tenantName: string; email: string; password: string; shopSlug: string };

export function CreateTenantForm({ plans }: { plans: { code: string; name: string }[] }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateTenantInput>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { planCode: plans[0]?.code ?? '' },
  });

  const onSubmit = async (data: CreateTenantInput) => {
    setServerError(null);
    const res = await createTenantAction(data);
    if (!res.ok) { setServerError(res.error); return; }
    setCreated({ tenantName: data.tenantName, email: data.ownerEmail, password: data.ownerPassword, shopSlug: data.shopSlug });
  };

  if (created) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return (
      <div className="grid max-w-2xl gap-4">
        <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 font-semibold text-success">
          <CheckCircle2 className="size-5" />
          「{created.tenantName}」を作成しました
        </div>
        <div className="rounded-xl border bg-muted/30 p-4">
          <p className="mb-2 text-sm font-medium text-slate-700">オーナーへ以下のログイン情報を安全にお伝えください</p>
          <dl className="grid gap-2 text-sm">
            <Row label="ログインURL" value={`${origin}/login`} />
            <Row label="メールアドレス" value={created.email} mono />
            <Row label="初期パスワード" value={created.password} mono />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            予約ページ（公開後）: <span className="font-mono">{origin}/book/{created.shopSlug}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setCreated(null); router.refresh(); }}
            className="rounded-md border px-4 py-2 text-sm hover:bg-slate-50"
          >
            続けて作成
          </button>
          <Link
            href="/platform/tenants"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            商家一覧へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid max-w-2xl gap-4">
      <FormError message={serverError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="商家名" required error={errors.tenantName?.message}>
          <Input {...register('tenantName')} placeholder="株式会社サンプル" />
        </Field>
        <Field label="商家slug" required error={errors.tenantSlug?.message} hint="URL等で使用">
          <Input {...register('tenantSlug')} placeholder="sample-co" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="初期店舗名" required error={errors.shopName?.message}>
          <Input {...register('shopName')} placeholder="本店" />
        </Field>
        <Field label="店舗slug" required error={errors.shopSlug?.message} hint="公開予約URL: /book/{slug}">
          <Input {...register('shopSlug')} placeholder="sample-honten" />
        </Field>
      </div>
      <Field label="プラン" error={errors.planCode?.message}>
        <Select {...register('planCode')}>
          {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </Select>
      </Field>
      <hr />
      <p className="text-sm font-medium text-slate-700">オーナーアカウント</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="オーナー名" required error={errors.ownerName?.message}>
          <Input {...register('ownerName')} placeholder="管理者 太郎" />
        </Field>
        <Field label="メール" required error={errors.ownerEmail?.message}>
          <Input type="email" {...register('ownerEmail')} placeholder="owner@sample.co" />
        </Field>
      </div>
      <Field label="初期パスワード" required error={errors.ownerPassword?.message} hint="8文字以上。オーナーへ安全に共有してください。">
        <Input type="text" {...register('ownerPassword')} />
      </Field>
      <SubmitBar submitting={isSubmitting} submitLabel="商家を作成" onCancel={() => router.push('/platform/tenants')} />
    </form>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={'select-all text-right ' + (mono ? 'font-mono font-medium text-slate-900' : 'text-slate-700')}>{value}</dd>
    </div>
  );
}
