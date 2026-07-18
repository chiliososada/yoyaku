'use client';

import { cloneElement, forwardRef, isValidElement, useId } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  // 単一の入力要素には id を付与し、label と紐付ける（アクセシビリティ）。
  const control =
    isValidElement(children) && !(children.props as { id?: string }).id
      ? cloneElement(children as React.ReactElement, {
          id,
          'aria-invalid': error ? true : undefined,
        })
      : children;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {control}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  ),
);
TextArea.displayName = 'TextArea';

/**
 * チェックボックス行。RHF の register() が返す ref を実際の <input> に届けるため
 * forwardRef necessário。関数コンポーネントのままだと ref が破棄され、
 * 既定値のチェック状態が DOM に反映されない（表示だけ未チェックになる）。
 */
export const CheckboxRow = forwardRef<
  HTMLInputElement,
  { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>
>(function CheckboxRow({ label, hint, ...props }, ref) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        ref={ref}
        type="checkbox"
        className="mt-0.5 size-4 rounded border-input text-primary focus:ring-ring"
        {...props}
      />
      <span>
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
});

/**
 * 複数選択のチェックボックス群を配列値として制御する。
 * RHF の「同名 input を暗黙的に配列化」する挙動は選択肢が1件だと配列にならない
 * （単一チェックボックス=boolean 扱い）ため、ここで明示的に string[] を管理する。
 */
export function CheckboxGroup({
  options,
  value,
  onChange,
  empty,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  empty?: string;
}) {
  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
      {options.length === 0 && <p className="text-sm text-muted-foreground">{empty ?? '項目がありません。'}</p>}
      {options.map((o) => {
        const checked = value.includes(o.id);
        return (
          <label key={o.id} className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-input text-primary focus:ring-ring"
              checked={checked}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((v) => v !== o.id))}
            />
            <span className="text-sm font-medium">{o.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

export function SubmitBar({
  submitting,
  submitLabel = '保存',
  onCancel,
}: {
  submitting: boolean;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          キャンセル
        </Button>
      )}
    </div>
  );
}
