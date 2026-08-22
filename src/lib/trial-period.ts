/**
 * 無料トライアルの期限まわりの計算（純関数・DB非依存）。
 *
 * 以前は画面とメールで別々の式を使っていて、表示が1日ずれていた:
 *   - 画面: `Math.ceil((trialEndsAt - now) / 86_400_000)`（経過時間の切り上げ）
 *   - メール: JST 暦日の差
 * `trialEndsAt` は「登録時刻 + 30日」なので時刻部分は商家ごとにバラバラ。
 * 上の2式は「現在の時刻 < 登録時刻」の間ずれるため、14時に登録した商家は
 * 毎日 00:00〜14:00 の14時間、メールと画面で違う数字を見ることになっていた。
 * しかも予告メールは worker の毎時スイープで JST 0時台に積まれるので、
 * 「メールを読んで画面を開く」という一番自然な動きで必ず食い違っていた。
 *
 * ここで数え方を1つに決める:
 *   - **期限日** = `trialEndsAt` の JST 暦日（メールに出る「2026年8月29日」）
 *   - **利用できるのはその日いっぱい** = 翌日 00:00 JST まで
 *   - **残り日数** = 期限日 − 今日（JST 暦日の差）。期限日当日は 0。
 *
 * 「その日いっぱい」にしたのは、メール本文が日付しか示しておらず
 * （「期限（2026年8月29日）まで」）、商家がその日の営業終わりに手続きしようとして
 * 締め出される事故を防ぐため。時刻まで書いても、登録時刻を覚えている人はいない。
 */
import { DEFAULT_TZ, zonedDateString, zonedDateMinutesToUtc, MINUTES_PER_DAY } from '@/lib/time';

/** 期限日（JST 暦日, YYYY-MM-DD）。メール・画面の表示はこれを基準にする。 */
export function trialEndDate(trialEndsAt: Date, timeZone: string = DEFAULT_TZ): string {
  return zonedDateString(trialEndsAt, timeZone);
}

/**
 * 実際に利用できなくなる瞬間 = 期限日の翌日 00:00（その日いっぱい使える）。
 * 課金ゲートの判定はこの値と比較する。
 */
export function trialExpiresAt(trialEndsAt: Date, timeZone: string = DEFAULT_TZ): Date {
  return zonedDateMinutesToUtc(trialEndDate(trialEndsAt, timeZone), MINUTES_PER_DAY, timeZone);
}

/**
 * 残り日数（JST 暦日の差）。
 *  - 正: あと N 日（期限日まで N 回日付が変わる）
 *  - 0 : 今日が期限日（今日いっぱい使える）
 *  - 負: 期限切れ
 */
export function trialDaysLeft(trialEndsAt: Date, now: Date, timeZone: string = DEFAULT_TZ): number {
  const end = Date.parse(`${trialEndDate(trialEndsAt, timeZone)}T00:00:00Z`);
  const today = Date.parse(`${zonedDateString(now, timeZone)}T00:00:00Z`);
  return Math.round((end - today) / 86_400_000);
}

/** まだ利用できるか（期限日の終わりまで true）。 */
export function isTrialActive(trialEndsAt: Date, now: Date, timeZone: string = DEFAULT_TZ): boolean {
  return trialExpiresAt(trialEndsAt, timeZone).getTime() > now.getTime();
}

/**
 * Stripe へ引き継ぐトライアル日数（切り上げ）。
 * 期限日の終わりまでを残日数とみなす。切り上げるのは、
 * 期限日の夜に申し込んだ商家からその日を取り上げないため。
 */
export function stripeTrialDays(trialEndsAt: Date | null, now: Date, timeZone: string = DEFAULT_TZ): number {
  if (!trialEndsAt) return 0;
  const ms = trialExpiresAt(trialEndsAt, timeZone).getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** 表示文言。期限日当日は日数ではなく「本日まで」と出す（「残り0日」は不安にさせる）。 */
export function trialRemainingLabel(daysLeft: number): string {
  if (daysLeft <= 0) return '本日まで';
  return `残り ${daysLeft} 日`;
}
