import { describe, it, expect } from 'vitest';
import {
  trialEndDate,
  trialExpiresAt,
  trialDaysLeft,
  isTrialActive,
  stripeTrialDays,
  trialRemainingLabel,
} from '@/lib/trial-period';
import { evaluateBillingAccess } from '@/server/billing/billing-service';

/** JST の壁時計時刻 → UTC の瞬間（JST = UTC+9、日本は夏時間なし）。 */
const jst = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h - 9, min, 0));

// 14時に登録した商家。trialEndsAt = 登録時刻 + 30日 なので時刻部分は 14:00。
const TRIAL_END = jst(2026, 8, 29, 14);

/** billing-notification-service が予告メールを選ぶときと同じ判定。 */
const mailTemplate = (now: Date) => {
  const d = trialDaysLeft(TRIAL_END, now);
  return d === 7 ? 'TRIAL_ENDING_7' : d === 3 ? 'TRIAL_ENDING_3' : d === 1 ? 'TRIAL_ENDING_1' : d < 0 ? 'TRIAL_ENDED' : null;
};

/** 画面が出す残り日数。 */
const screenDays = (now: Date) => {
  const g = evaluateBillingAccess(
    { billingExempt: false, stripeSubscriptionStatus: null, trialEndsAt: TRIAL_END, currentPeriodEnd: null },
    { now, stripeConfigured: true },
  );
  return g.state === 'TRIAL' ? g.trialDaysLeft : null;
};

describe('trialEndDate / trialExpiresAt', () => {
  it('期限日は trialEndsAt の JST 暦日', () => {
    expect(trialEndDate(TRIAL_END)).toBe('2026-08-29');
    // UTC では前日でも、JST 暦日で判定する
    expect(trialEndDate(new Date('2026-08-29T15:30:00Z'))).toBe('2026-08-30');
    expect(trialEndDate(new Date('2026-08-29T14:59:00Z'))).toBe('2026-08-29');
  });

  it('利用できなくなるのは期限日の翌日 0時（JST）', () => {
    expect(trialExpiresAt(TRIAL_END).toISOString()).toBe(jst(2026, 8, 30, 0).toISOString());
  });
});

describe('trialDaysLeft', () => {
  it('JST 暦日の差で数える。時刻には依存しない', () => {
    // 同じ 8/22 なら、何時に見ても 7
    for (const h of [0, 6, 13, 14, 15, 23]) {
      expect(trialDaysLeft(TRIAL_END, jst(2026, 8, 22, h))).toBe(7);
    }
  });

  it('期限日当日は 0、翌日は -1', () => {
    expect(trialDaysLeft(TRIAL_END, jst(2026, 8, 29, 0))).toBe(0);
    expect(trialDaysLeft(TRIAL_END, jst(2026, 8, 29, 23, 59))).toBe(0);
    expect(trialDaysLeft(TRIAL_END, jst(2026, 8, 30, 0))).toBe(-1);
  });
});

describe('isTrialActive', () => {
  it('期限日はいっぱいまで使え、翌日 0時に切れる', () => {
    expect(isTrialActive(TRIAL_END, jst(2026, 8, 29, 13, 59))).toBe(true);
    // 旧実装はここ（登録時刻）で締め出していた
    expect(isTrialActive(TRIAL_END, jst(2026, 8, 29, 14, 0))).toBe(true);
    expect(isTrialActive(TRIAL_END, jst(2026, 8, 29, 23, 59))).toBe(true);
    expect(isTrialActive(TRIAL_END, jst(2026, 8, 30, 0, 0))).toBe(false);
  });
});

describe('画面とメールの数字が一致する（回帰）', () => {
  /**
   * 以前は画面が `Math.ceil((trialEndsAt - now)/86400000)`、メールが JST 暦日差で、
   * 「現在の時刻 < 登録時刻」の間ずっと 1 日ずれていた。
   * 予告メールは worker の毎時スイープで JST 0時台に積まれるため、
   * 「メールを読んで画面を開く」動作で必ず食い違っていた。
   */
  it.each([0, 1, 6, 9, 12, 13, 14, 15, 20, 23])('8/22 %d時 — メール送信日と画面が同じ数字', (h) => {
    const now = jst(2026, 8, 22, h);
    expect(mailTemplate(now)).toBe('TRIAL_ENDING_7');
    expect(screenDays(now)).toBe(7);
  });

  it.each([0, 9, 14, 23])('8/28 %d時 — T-1 メールと画面が一致', (h) => {
    const now = jst(2026, 8, 28, h);
    expect(mailTemplate(now)).toBe('TRIAL_ENDING_1');
    expect(screenDays(now)).toBe(1);
  });

  it('期限日当日はメールを送らず、画面は「本日まで」', () => {
    for (const h of [0, 13, 14, 20, 23]) {
      const now = jst(2026, 8, 29, h);
      expect(mailTemplate(now)).toBeNull(); // まだ終わっていない
      expect(screenDays(now)).toBe(0);
      expect(trialRemainingLabel(screenDays(now)!)).toBe('本日まで');
    }
  });

  it('期限日の翌日にロックされ、同じ日に終了メールが出る', () => {
    const now = jst(2026, 8, 30, 0, 1);
    expect(mailTemplate(now)).toBe('TRIAL_ENDED');
    expect(screenDays(now)).toBeNull(); // LOCKED
  });
});

describe('stripeTrialDays', () => {
  it('期限日の終わりまでを切り上げて渡す（夜に申し込んでも当日を取り上げない）', () => {
    // 8/29 20:00 時点で残りは 4 時間 → 切り上げて 1 日
    expect(stripeTrialDays(TRIAL_END, jst(2026, 8, 29, 20))).toBe(1);
    // 旧実装は 8/29 14:00 を過ぎると 0（＝即時満額請求）になっていた
    expect(stripeTrialDays(TRIAL_END, jst(2026, 8, 22, 9))).toBe(8);
    expect(stripeTrialDays(TRIAL_END, jst(2026, 8, 30, 0, 1))).toBe(0);
    expect(stripeTrialDays(null, jst(2026, 8, 22))).toBe(0);
  });
});

describe('trialRemainingLabel', () => {
  it('0日以下は「本日まで」（「残り0日」は終わったように読める）', () => {
    expect(trialRemainingLabel(0)).toBe('本日まで');
    expect(trialRemainingLabel(-1)).toBe('本日まで');
    expect(trialRemainingLabel(1)).toBe('残り 1 日');
    expect(trialRemainingLabel(23)).toBe('残り 23 日');
  });
});
