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
  })
  /**
   * 時間帯分割（segments）の整合。指定すると **durationMin より segments が優先される**ため、
   * ここが緩いと店主の自覚なく所要時間が別物になる:
   *  - ［区間を追加］を1回押すと既定値（+0分/30分）が入り、90分メニューが実質30分になる。
   *    その結果、同じスタッフに30分間隔で予約が入り**二重予約が成立してしまう**。
   *  - 同じ既定値のまま2回押すと区間が重なり、その menu は全時間帯で予約不能になる
   *    （画面上は○のまま「満席です」と出る）。
   * どちらも症状から原因に辿り着けないため、入力時に弾く。
   */
  .superRefine((v, ctx) => {
    const segs = v.segments;
    if (!segs || segs.length === 0) return;

    const sorted = [...segs].sort((a, b) => a.offsetMin - b.offsetMin);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.offsetMin < prev.offsetMin + prev.durationMin) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments'],
          message:
            `時間帯分割が重なっています（開始+${prev.offsetMin}分から${prev.durationMin}分 と ` +
            `開始+${cur.offsetMin}分から${cur.durationMin}分）。重ならないように設定してください。`,
        });
        return;
      }
    }
    // 分割の全長が所要時間と食い違うと、実際の占有が所要時間と別物になる
    const last = sorted[sorted.length - 1]!;
    const span = last.offsetMin + last.durationMin;
    if (span !== v.durationMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['segments'],
        message:
          `時間帯分割の合計（開始から${span}分）が所要時間（${v.durationMin}分）と一致しません。` +
          `分割を使う場合は、最後の区間の終わりが所要時間と同じになるように設定してください。`,
      });
    }
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
export const capacityRuleSchema = z
  .object({
    maxConcurrent: z.coerce.number().int().min(1, '1以上').max(1000),
    slotIntervalMin: z.coerce.number().int().min(5).max(240),
    bookingWindowDays: z.coerce.number().int().min(0).max(365),
    leadTimeMinHours: z.coerce.number().int().min(0).max(720),
    cancellationDeadlineHours: z.coerce.number().int().min(0).max(720),
  })
  /**
   * 各項目は妥当でも、組合せが「予約が1件も取れない」設定になりうる。
   * 症状は「全部の日が×」で、店主はどの項目が原因か特定できないため入力時に弾く。
   */
  .superRefine((v, ctx) => {
    // 締切が受付期間より先にあると、受付可能な日は全て締切超過になる
    if (v.bookingWindowDays > 0 && v.leadTimeMinHours > v.bookingWindowDays * 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leadTimeMinHours'],
        message:
          `締切（${v.leadTimeMinHours}時間前）が受付期間（${v.bookingWindowDays}日先まで＝${v.bookingWindowDays * 24}時間）を超えています。` +
          `この組合せでは予約を1件も受け付けられません。`,
      });
    }
    // 受付期間0日 = 当日のみ受付。締切が24時間以上だと当日枠が全て締切超過になる
    if (v.bookingWindowDays === 0 && v.leadTimeMinHours >= 24) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leadTimeMinHours'],
        message: '受付期間が当日のみのため、締切は24時間未満にしてください（現状では予約を受け付けられません）。',
      });
    }
  });
export type CapacityRuleInput = z.infer<typeof capacityRuleSchema>;

// ---- スタッフシフト ----
/**
 * スタッフの曜日シフト。businessHoursSchema と**同じ壊れ方**をするので同じ守り方をする:
 *  - 終了 <= 開始 … 静かに捨てられるとその曜日だけ出勤が消え、原因が分からない
 *  - 同一曜日の重なり … resolveStaffWorkingIntervals は行ごとに区間を積むだけで連結しないため、
 *    isWorkingDuring（1本の区間が施術全体を覆うことを要求）が継ぎ目をまたぐ長いメニューを弾く。
 *    店主から見ると「10-15と14-19を入れたのに、60分メニューだけ予約できない」ように見える。
 */
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
}).superRefine((val, ctx) => {
  val.rows.forEach((r, i) => {
    if (r.endMinute <= r.startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', i, 'endMinute'],
        message: `${DOW_LABEL[r.dayOfWeek]}曜: 終了時刻は開始時刻より後にしてください。`,
      });
    }
  });
  const byDay = new Map<number, Array<{ i: number; s: number; e: number }>>();
  val.rows.forEach((r, i) => {
    if (r.endMinute <= r.startMinute) return;
    const list = byDay.get(r.dayOfWeek) ?? [];
    list.push({ i, s: r.startMinute, e: r.endMinute });
    byDay.set(r.dayOfWeek, list);
  });
  for (const [dow, list] of byDay) {
    list.sort((a, b) => a.s - b.s);
    for (let k = 1; k < list.length; k++) {
      const prev = list[k - 1]!;
      const cur = list[k]!;
      if (cur.s < prev.e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', cur.i, 'startMinute'],
          message:
            `${DOW_LABEL[dow]}曜のシフトが重なっています（${hhmm(prev.s)}〜${hhmm(prev.e)} と ` +
            `${hhmm(cur.s)}〜${hhmm(cur.e)}）。休憩を挟む場合は重ならないように分けてください。`,
        });
      }
    }
  }
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
const DOW_LABEL = ['日', '月', '火', '水', '木', '金', '土'] as const;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const businessHourRowSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  openMinute: z.coerce.number().int().min(0).max(1440),
  closeMinute: z.coerce.number().int().min(0).max(1440),
});

/**
 * 営業時間。同じ曜日に複数行を置けるのは**昼休みなどの分割営業**のため（意図した機能）。
 * ただし次の2つは弾く。どちらも「保存はできたのに結果が違う」という、
 * 店主が自力で原因に辿り着けない壊れ方をするため:
 *
 *  1. 終了 <= 開始 … resolveOpenIntervalsForDate が `closeMinute > openMinute` で
 *     静かに除外するので、その曜日が理由の説明もなく定休になる。
 *  2. 同じ曜日の時間帯が重なる … computeAvailability は営業区間ごとに独立して
 *     候補時刻を生成して連結するため、**顧客の予約画面に同じ時刻が2回並ぶ**。
 *     日付の○△×の空き数も水増しされる（予約の二重確保は別途DB制約が防ぐので起きない）。
 */
export const businessHoursSchema = z.object({
  rows: z.array(businessHourRowSchema).max(50),
}).superRefine((val, ctx) => {
  val.rows.forEach((r, i) => {
    if (r.closeMinute <= r.openMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rows', i, 'closeMinute'],
        message: `${DOW_LABEL[r.dayOfWeek]}曜: 終了時刻は開始時刻より後にしてください。`,
      });
    }
  });

  // 曜日ごとに開始順へ並べ、隣接行の重なりを検出する
  const byDay = new Map<number, Array<{ i: number; open: number; close: number }>>();
  val.rows.forEach((r, i) => {
    if (r.closeMinute <= r.openMinute) return; // 上で別途エラー済み
    const list = byDay.get(r.dayOfWeek) ?? [];
    list.push({ i, open: r.openMinute, close: r.closeMinute });
    byDay.set(r.dayOfWeek, list);
  });
  for (const [dow, list] of byDay) {
    list.sort((a, b) => a.open - b.open);
    for (let k = 1; k < list.length; k++) {
      const prev = list[k - 1]!;
      const cur = list[k]!;
      // 半開区間として扱う: 13:00終了 と 13:00開始 は重なりではない（連続営業）
      if (cur.open < prev.close) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', cur.i, 'openMinute'],
          message:
            `${DOW_LABEL[dow]}曜の時間帯が重なっています（${hhmm(prev.open)}〜${hhmm(prev.close)} と ` +
            `${hhmm(cur.open)}〜${hhmm(cur.close)}）。昼休みを設ける場合は重ならないように分けてください。`,
        });
      }
    }
  }
});
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;
