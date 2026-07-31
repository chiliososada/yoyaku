/**
 * 顧客カルテの同定キーを正規化する（純関数）。
 *
 * 保存する値と突き合わせる値は必ず同じ正規化を通すこと。
 * どちらか一方だけを正規化すると「Taro@Gmail.com と taro@gmail.com が別人」
 * 「090-1234-5678 と 09012345678 が別人」になり、常連が毎回新規カルテになる。
 */

/** メールは小文字化（ドメインもローカル部も大小を区別しない運用にする）。 */
export function normalizeEmailKey(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().toLowerCase();
  return s === '' ? null : s;
}

/**
 * 電話は数字のみに落とす。ハイフン・括弧・空白・全角は表記ゆれでしかなく、
 * 同じ番号を別人にしてしまう。国際表記の先頭 + は落ちるが、
 * 同定キーとしては桁の並びが一致すれば十分。
 */
export function normalizePhoneKey(v: string | null | undefined): string | null {
  if (v == null) return null;
  const digits = v
    // 全角数字を半角へ
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '');
  return digits === '' ? null : digits;
}
