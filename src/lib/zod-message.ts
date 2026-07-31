/**
 * ZodError から「そのまま画面に出せる日本語のメッセージ」を取り出す。
 *
 * なぜ必要か:
 *   スキーマ側では「月曜の時間帯が重なっています（10:00〜19:00 と 10:00〜19:00）」のように
 *   曜日と実際の時刻まで入れた文言を用意しているのに、入口（server action / route handler）が
 *   ZodError を一律の文言に潰していたため、店主には
 *   「処理に失敗しました。時間をおいて再度お試しください。」しか出ていなかった。
 *   直し方が分からないうえ、時間をおいても直らない（＝完全な行き止まり）。
 *
 * 型エラー等の内部的な issue（英語）は出さない。ユーザー向けに書かれた文言だけを拾い、
 * 何も拾えなければ汎用文言に落とす。
 */
import type { ZodError, ZodIssue } from 'zod';

/** 画面に出してよい文言か（日本語を含み、zod 既定の英語メッセージでないこと）。 */
function isUserFacing(issue: ZodIssue): boolean {
  const m = issue.message;
  if (!m) return false;
  // 日本語（ひらがな・カタカナ・漢字）を含むものだけをユーザー向けとみなす
  return /[぀-ヿ一-龯]/.test(m);
}

export const GENERIC_VALIDATION_MESSAGE = '入力内容をご確認ください。';

/**
 * 先頭から最大 max 件の日本語メッセージを結合して返す。
 * 複数の曜日が同時に不正なときに1件だけ出すと、直しても直しても弾かれることになる。
 */
export function zodUserMessage(err: ZodError, max = 3): string {
  // 重複を除いた「異なる指摘」の集合。同じ文言が複数項目から出ても1件として数える
  // （数えないと、表示できるものが無いのに「ほか1件」と出て、探しても見つからない）。
  const distinct: string[] = [];
  const seen = new Set<string>();
  for (const issue of err.issues) {
    if (!isUserFacing(issue)) continue;
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    distinct.push(issue.message);
  }
  if (distinct.length === 0) return GENERIC_VALIDATION_MESSAGE;
  const shown = distinct.slice(0, max);
  const more = distinct.length - shown.length;
  return more > 0 ? `${shown.join(' / ')} ほか${more}件` : shown.join(' / ');
}
