/**
 * プラットフォーム後台の書込 Zod スキーマ。
 */
import { z } from 'zod';
import { passwordSchema } from './password';
import { isReservedSlug } from '@/lib/shop-slug';

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, '英小文字・数字・ハイフンのみ')
  .min(2)
  .max(50)
  .refine((s) => !isReservedSlug(s), 'この名前は使用できません。別の名前をお選びください。');

export const createTenantSchema = z.object({
  tenantName: z.string().trim().min(1, '商家名を入力してください。').max(100),
  tenantSlug: slug,
  shopName: z.string().trim().min(1, '店舗名を入力してください。').max(100),
  shopSlug: slug,
  ownerName: z.string().trim().min(1, 'オーナー名を入力してください。').max(100),
  ownerEmail: z.string().trim().email('メール形式が不正です。'),
  ownerPassword: passwordSchema,
  planCode: z.string().optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const setUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

export const planFormSchema = z.object({
  name: z.string().trim().min(1).max(100),
  priceJpy: z.coerce.number().int().min(0).max(10_000_000),
  maxShops: z.coerce.number().int().min(1).max(1000),
  maxStaffPerShop: z.coerce.number().int().min(1).max(1000),
  /// 0 = 無制限。有料プランは 0 を使う（件数で顧客の予約を止めないため）
  maxBookingsPerMonth: z.coerce.number().int().min(0).max(10_000_000),
  /// Stripe Price ID（price_...）。設定するとオンライン申込（Checkout）対象になる
  stripePriceId: z
    .string()
    .trim()
    .regex(/^price_[A-Za-z0-9]+$/, 'price_ で始まる Stripe Price ID を入力してください。')
    .optional()
    .or(z.literal('')),
  isActive: z.boolean().default(true),
});
export type PlanFormInput = z.infer<typeof planFormSchema>;
