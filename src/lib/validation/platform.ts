/**
 * プラットフォーム後台の書込 Zod スキーマ。
 */
import { z } from 'zod';

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, '英小文字・数字・ハイフンのみ')
  .min(2)
  .max(50);

export const createTenantSchema = z.object({
  tenantName: z.string().trim().min(1, '商家名を入力してください。').max(100),
  tenantSlug: slug,
  shopName: z.string().trim().min(1, '店舗名を入力してください。').max(100),
  shopSlug: slug,
  ownerName: z.string().trim().min(1, 'オーナー名を入力してください。').max(100),
  ownerEmail: z.string().trim().email('メール形式が不正です。'),
  ownerPassword: z.string().min(8, 'パスワードは8文字以上。').max(100),
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
  maxBookingsPerMonth: z.coerce.number().int().min(1).max(10_000_000),
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
