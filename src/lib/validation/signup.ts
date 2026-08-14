/**
 * 公開セルフサーブ登録の Zod スキーマ。
 *
 * slug は入力させない: 公開URL（/{slug} と /book/{slug}）になる値をこの段階で決めさせると
 * 重複・予約語・後悔が発生し、登録の離脱要因になる。サーバー側で一意な仮 slug を発番し、
 * 店舗設定からいつでも変更できる（validation/admin.ts の slug 検証を通す）。
 */
import { z } from 'zod';
import { passwordSchema } from './password';

export const signupRequestSchema = z.object({
  tenantName: z.string().trim().min(1, '会社名・屋号を入力してください。').max(100),
  shopName: z.string().trim().min(1, '店舗名を入力してください。').max(100),
  ownerName: z.string().trim().min(1, 'お名前を入力してください。').max(100),
  email: z.string().trim().toLowerCase().email('メールアドレスの形式が正しくありません。').max(200),
  password: passwordSchema,
  /// 利用規約・プライバシーへの同意（特商法対応の観点でも取得を明示）
  agreed: z.literal(true, { errorMap: () => ({ message: '利用規約とプライバシーポリシーへの同意が必要です。' }) }),
});
export type SignupRequestInput = z.infer<typeof signupRequestSchema>;
