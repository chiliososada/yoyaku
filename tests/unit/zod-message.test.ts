/**
 * ZodError → 画面に出す文言の取り出し。
 *
 * 守りたいこと: スキーマ側で用意した「どこがどう悪いか」を潰さない。
 * 潰すと店主には「時間をおいて再度お試しください」しか出ず、時間をおいても直らない。
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodUserMessage, GENERIC_VALIDATION_MESSAGE } from '@/lib/zod-message';

function errOf(schema: z.ZodTypeAny, value: unknown): z.ZodError {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('expected failure');
  return r.error;
}

describe('zodUserMessage', () => {
  it('日本語のメッセージをそのまま返す', () => {
    const s = z.object({ name: z.string().min(1, 'お名前を入力してください。') });
    expect(zodUserMessage(errOf(s, { name: '' }))).toBe('お名前を入力してください。');
  });

  it('複数の指摘を結合する（1件ずつ直させない）', () => {
    const s = z.object({
      a: z.string().min(1, '月曜: 終了時刻は開始時刻より後にしてください。'),
      b: z.string().min(1, '火曜: 終了時刻は開始時刻より後にしてください。'),
    });
    const msg = zodUserMessage(errOf(s, { a: '', b: '' }));
    expect(msg).toContain('月曜');
    expect(msg).toContain('火曜');
    expect(msg).toContain(' / ');
  });

  it('異なる指摘が多いときは残数を添える', () => {
    const shape: Record<string, z.ZodTypeAny> = {};
    const value: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      shape[`f${i}`] = z.string().min(1, `${i}番目の項目を入力してください。`);
      value[`f${i}`] = '';
    }
    const msg = zodUserMessage(errOf(z.object(shape), value), 3);
    expect(msg).toMatch(/ほか3件$/);
  });

  it('同じ文言は重複させない', () => {
    const s = z.object({ a: z.string().min(1, '入力してください。'), b: z.string().min(1, '入力してください。') });
    const msg = zodUserMessage(errOf(s, { a: '', b: '' }));
    expect(msg).toBe('入力してください。');
  });

  it('zod 既定の英語メッセージは画面に出さない', () => {
    const s = z.object({ n: z.number() });
    expect(zodUserMessage(errOf(s, { n: 'x' }))).toBe(GENERIC_VALIDATION_MESSAGE);
  });

  it('英語と日本語が混ざるときは日本語だけを拾う', () => {
    const s = z.object({ n: z.number(), name: z.string().min(1, 'お名前が必要です。') });
    const msg = zodUserMessage(errOf(s, { n: 'x', name: '' }));
    expect(msg).toBe('お名前が必要です。');
  });

  it('実際の営業時間スキーマの文言が通る（曜日と時刻を含む）', async () => {
    const { businessHoursSchema } = await import('@/lib/validation/admin');
    const e = errOf(businessHoursSchema, {
      rows: [
        { dayOfWeek: 1, openMinute: 600, closeMinute: 1140 },
        { dayOfWeek: 1, openMinute: 600, closeMinute: 1140 },
      ],
    });
    const msg = zodUserMessage(e);
    expect(msg).toContain('月曜');
    expect(msg).toContain('10:00');
    expect(msg).not.toBe(GENERIC_VALIDATION_MESSAGE);
  });
});
