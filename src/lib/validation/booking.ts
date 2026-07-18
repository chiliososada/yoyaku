/**
 * 予約まわりの Zod スキーマ。入口層（route handlers / server actions）で必ず検証。
 */
import { z } from 'zod';

/** yyyy-MM-dd（実在する暦日のみ。2026-02-31 のような不正日を弾く）。 */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください。')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number);
    // UTC で構築して各要素が一致するか（ロールオーバーを検出）
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, '存在しない日付です。');

/** カンマ区切りID列（GET クエリ用）。 */
const idListSchema = z
  .string()
  .min(1)
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.string().min(1)).min(1).max(3));

const optionIdListSchema = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(z.string().min(1)).max(10));

/** serviceId（単一・後方互換） / serviceIds（コンボ）のどちらかを必須にする共通形。 */
const serviceSelectionFields = {
  serviceId: z.string().min(1).optional(),
  serviceIds: idListSchema.optional(),
  optionIds: optionIdListSchema.optional(),
};

function requireServiceSelection<T extends { serviceId?: string; serviceIds?: string[] }>(v: T) {
  return Boolean(v.serviceId) || (v.serviceIds?.length ?? 0) > 0;
}

export const availabilityQuerySchema = z
  .object({
    ...serviceSelectionFields,
    staffId: z.string().min(1).optional(),
    date: isoDateSchema,
  })
  .refine(requireServiceSelection, { message: 'サービスを選択してください。', path: ['serviceId'] });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

/** 日付ストリップの空き状況サマリ（○△×）用クエリ。 */
export const dateAvailabilityQuerySchema = z
  .object({
    ...serviceSelectionFields,
    staffId: z.string().min(1).optional(),
    from: isoDateSchema,
    days: z.coerce.number().int().min(1).max(60).default(30),
  })
  .refine(requireServiceSelection, { message: 'サービスを選択してください。', path: ['serviceId'] });
export type DateAvailabilityQuery = z.infer<typeof dateAvailabilityQuerySchema>;

export const customerInfoSchema = z.object({
  name: z.string().trim().min(1, 'お名前を入力してください。').max(100),
  nameKana: z.string().trim().max(100).optional(),
  email: z.string().trim().email('メールアドレスの形式が正しくありません。').optional().or(z.literal('')),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]{8,20}$/, '電話番号の形式が正しくありません。')
    .optional()
    .or(z.literal('')),
});

/** コンボ予約の1サービス選択（POST ボディ用）。 */
export const serviceItemSchema = z.object({
  serviceId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).max(10).optional(),
});

export const createBookingSchema = z
  .object({
    /** 単一サービス（後方互換）。serviceItems 指定時は不要 */
    serviceId: z.string().min(1).optional(),
    /** コンボ予約: 実施順のサービス群（最大3件、各サービスにオプション可） */
    serviceItems: z.array(serviceItemSchema).min(1).max(3).optional(),
    staffId: z.string().min(1).nullish(),
    /** 最初のサービスの開始時刻（ISO 8601, UTC） */
    startAt: z.string().datetime({ message: '開始時刻の形式が正しくありません。' }),
    customer: customerInfoSchema,
    note: z.string().trim().max(1000).optional(),
    partySize: z.number().int().min(1).max(20).optional(),
    idempotencyKey: z.string().min(1).max(100).optional(),
    /** LINE(LIFF) 経由予約の顧客 userId。あれば連絡先はこれで代替（確認/リマインドは LINE で送る）。 */
    lineUserId: z.string().min(1).max(100).optional(),
  })
  .refine((v) => Boolean(v.serviceId) || (v.serviceItems?.length ?? 0) > 0, {
    message: 'サービスを選択してください。',
    path: ['serviceId'],
  })
  .refine((v) => Boolean(v.customer.email) || Boolean(v.customer.phone) || Boolean(v.lineUserId), {
    message: 'メールアドレスまたは電話番号のいずれかを入力してください。',
    path: ['customer', 'email'],
  });
export type CreateBookingBody = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** 管理画面からの代理予約。顧客連絡先は任意（対面登録のため）。 */
export const adminBookingSchema = z.object({
  serviceId: z.string().min(1, 'メニューを選択してください。'),
  staffId: z.string().min(1).nullish(),
  startAt: z.string().datetime({ message: '時間枠を選択してください。' }),
  customer: customerInfoSchema,
  note: z.string().trim().max(1000).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
});
export type AdminBookingBody = z.infer<typeof adminBookingSchema>;

