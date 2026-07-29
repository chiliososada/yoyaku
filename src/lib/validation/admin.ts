/**
 * 管理画面の書込 Zod スキーマ。client(RHF) と server action の双方で使用。
 */
import { z } from 'zod';
import { isReservedSlug } from '@/lib/shop-slug';

const optionalString = z.string().trim().max(200).optional().or(z.literal(''));

// ---- スタッフ ----
export const staffFormSchema = z.object({
  name: z.string().trim().min(1, '氏名を入力してください。').max(100),
  displayName: optionalString,
  email: z.string().trim().email('メール形式が不正です。').optional().or(z.literal('')),
  phone: optionalString,
  bio: z.string().trim().max(1000).optional().or(z.literal('')),
  isBookable: z.boolean().default(true),
  capacity: z.coerce.number().int().min(1).max(50).default(1),
  nominationFeeJpy: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  serviceIds: z.array(z.string()).default([]),
});
export type StaffFormInput = z.infer<typeof staffFormSchema>;

// ---- サービス ----
export const segmentSchema = z.object({
  offsetMin: z.coerce.number().int().min(0).max(1440),
  durationMin: z.coerce.number().int().min(1).max(1440),
});

/** サービスオプション（追加メニュー）。id ありは更新、なしは新規。 */
export const serviceOptionFormSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'オプション名を入力してください。').max(100),
  priceJpy: z.coerce.number().int().min(0).max(1_000_000).default(0),
  extraDurationMin: z.coerce.number().int().min(0).max(240).default(0),
});
export type ServiceOptionFormInput = z.infer<typeof serviceOptionFormSchema>;

export const serviceFormSchema = z
  .object({
    name: z.string().trim().min(1, 'メニュー名を入力してください。').max(100),
    category: optionalString,
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    durationMin: z.coerce.number().int().min(1, '所要時間を入力してください。').max(1440),
    bufferAfterMin: z.coerce.number().int().min(0).max(240).default(0),
    priceJpy: z.coerce.number().int().min(0).max(10_000_000).default(0),
    // セール価格（任意）。空欄=セールなし。設定時は通常料金より安いこと。
    salePriceJpy: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? null : v),
      z.coerce.number().int().min(1, 'セール価格は1円以上で入力してください。').max(10_000_000).nullable(),
    ),
    capacity: z.coerce.number().int().min(1).max(100).default(1),
    requiresStaff: z.boolean().default(true),
    slotIntervalMin: z.coerce.number().int().min(5).max(240).default(15),
    color: optionalString,
    isActive: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).default(0),
    staffIds: z.array(z.string()).default([]),
    segments: z.array(segmentSchema).optional(),
    options: z.array(serviceOptionFormSchema).max(20).default([]),
  })
  .refine((v) => !v.requiresStaff || v.staffIds.length > 0, {
    message: '担当スタッフを1名以上選択してください。',
    path: ['staffIds'],
  })
  .refine((v) => v.salePriceJpy == null || v.salePriceJpy < v.priceJpy, {
    message: 'セール価格は通常料金より安く設定してください。',
    path: ['salePriceJpy'],
  });
export type ServiceFormInput = z.infer<typeof serviceFormSchema>;

// ---- スタッフのログインアカウント ----
export const staffLoginSchema = z.object({
  email: z.string().trim().email('メール形式が不正です。'),
  password: z.string().min(8, 'パスワードは8文字以上で入力してください。').max(100),
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

// ---- 店舗新規作成 ----
export const shopCreateSchema = z.object({
  name: z.string().trim().min(1, '店舗名を入力してください。').max(100),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/, '英小文字・数字・ハイフンのみ')
    .min(2)
    .max(50)
    .refine((s) => !isReservedSlug(s), 'この名前は使用できません。別の名前をお選びください。'),
  timezone: z.string().default('Asia/Tokyo'),
});
export type ShopCreateInput = z.infer<typeof shopCreateSchema>;

// ---- 店舗設定 ----
export const shopSettingsSchema = z.object({
  name: z.string().trim().min(1, '店舗名を入力してください。').max(100),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  phone: optionalString,
  email: z.string().trim().email().optional().or(z.literal('')),
  postalCode: optionalString,
  prefecture: optionalString,
  city: optionalString,
  address: optionalString,
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).default('DRAFT'),
  publicBookingEnabled: z.boolean().default(false),
  closeOnNationalHolidays: z.boolean().default(true),
  shopCapacity: z.coerce.number().int().min(1).max(1000).default(1),
});
export type ShopSettingsInput = z.infer<typeof shopSettingsSchema>;

// ---- 店舗ホームページ（専属HP・SEO公開ページ） ----
/** JSON-LD 用のビジネス種別（schema.org 準拠の型のみ）。 */
export const HP_BUSINESS_TYPES = ['HairSalon', 'BeautySalon', 'NailSalon', 'DaySpa', 'HealthAndBeautyBusiness'] as const;
export type HpBusinessType = (typeof HP_BUSINESS_TYPES)[number];
export const HP_BUSINESS_TYPE_LABELS: Record<HpBusinessType, string> = {
  HairSalon: '美容室・ヘアサロン',
  BeautySalon: 'エステ・ビューティーサロン',
  NailSalon: 'ネイルサロン',
  DaySpa: 'スパ・リラクゼーション',
  HealthAndBeautyBusiness: 'その他（美容・健康）',
};

const uploadKey = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.webp$/, '不正な画像キーです。')
  .max(128);
/// http(s) のみ許可（javascript: 等のスキームによる stored XSS を遮断）
const hpUrl = z
  .string()
  .trim()
  .url('URL形式で入力してください。')
  .regex(/^https?:\/\//i, 'http:// または https:// のURLのみ使用できます。')
  .max(300)
  .optional()
  .or(z.literal(''));

export const shopHomepageSchema = z.object({
  tagline: z.string().trim().max(80).optional().or(z.literal('')),
  about: z.string().trim().max(2000).optional().or(z.literal('')),
  businessType: z.enum(HP_BUSINESS_TYPES).default('HealthAndBeautyBusiness'),
  accessNote: z.string().trim().max(500).optional().or(z.literal('')),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB 形式で入力してください。')
    .optional()
    .or(z.literal('')),
  instagramUrl: hpUrl,
  lineUrl: hpUrl,
  xUrl: hpUrl,
  websiteUrl: hpUrl,
  homepageEnabled: z.boolean().default(false),
  showMenu: z.boolean().default(true),
  showStaff: z.boolean().default(true),
  showGallery: z.boolean().default(true),
  showAddress: z.boolean().default(true),
  seoTitle: z.string().trim().max(70).optional().or(z.literal('')),
  seoDescription: z.string().trim().max(160).optional().or(z.literal('')),
  heroImageKey: uploadKey.optional().or(z.literal('')),
  logoImageKey: uploadKey.optional().or(z.literal('')),
  gallery: z.array(uploadKey).max(12).default([]),
});
export type ShopHomepageInput = z.infer<typeof shopHomepageSchema>;

// ---- 特別営業日 ----
export const specialDaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式。'),
    type: z.enum(['CLOSED', 'SPECIAL_OPEN', 'MODIFIED_HOURS']),
    openMinute: z.coerce.number().int().min(0).max(1440).optional(),
    closeMinute: z.coerce.number().int().min(0).max(1440).optional(),
    reason: optionalString,
  })
  .refine(
    (v) => v.type === 'CLOSED' || (v.openMinute != null && v.closeMinute != null && v.closeMinute > v.openMinute),
    { message: '営業時間（開始 < 終了）を入力してください。', path: ['closeMinute'] },
  );
export type SpecialDayInput = z.infer<typeof specialDaySchema>;

// ---- 容量ルール（既存ルールの編集） ----
export const capacityRuleSchema = z.object({
  maxConcurrent: z.coerce.number().int().min(1, '1以上').max(1000),
  slotIntervalMin: z.coerce.number().int().min(5).max(240),
  bookingWindowDays: z.coerce.number().int().min(0).max(365),
  leadTimeMinHours: z.coerce.number().int().min(0).max(720),
  cancellationDeadlineHours: z.coerce.number().int().min(0).max(720),
});
export type CapacityRuleInput = z.infer<typeof capacityRuleSchema>;

// ---- スタッフシフト ----
export const staffScheduleSchema = z.object({
  rows: z
    .array(
      z.object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        startMinute: z.coerce.number().int().min(0).max(1440),
        endMinute: z.coerce.number().int().min(0).max(1440),
      }),
    )
    .max(50),
});
export type StaffScheduleInput = z.infer<typeof staffScheduleSchema>;

export const staffOverrideSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式。'),
    isWorking: z.boolean(),
    startMinute: z.coerce.number().int().min(0).max(1440).optional(),
    endMinute: z.coerce.number().int().min(0).max(1440).optional(),
    note: optionalString,
  })
  .refine((v) => !v.isWorking || (v.startMinute != null && v.endMinute != null && v.endMinute > v.startMinute), {
    message: '出勤時間（開始 < 終了）を入力してください。',
    path: ['endMinute'],
  });
export type StaffOverrideInput = z.infer<typeof staffOverrideSchema>;

// ---- 営業時間（曜日ごと複数区間） ----
export const businessHourRowSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  openMinute: z.coerce.number().int().min(0).max(1440),
  closeMinute: z.coerce.number().int().min(0).max(1440),
});
export const businessHoursSchema = z.object({
  rows: z.array(businessHourRowSchema).max(50),
});
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;
