/**
 * 郵便番号の正規化（純関数・DB/ネットワーク非依存）。
 *
 * 店主は「105-0004」「〒1050004」「１０５－０００４」のどれでも打つ。
 * 表記ゆれで検索できないと「入れたのに出ない」になり、原因が画面に出ない。
 */

/** 全角英数字・記号を半角へ。 */
function toHalfWidth(v: string): string {
  return v.replace(/[０-９－ー−―‐]/g, (c) => {
    if (c >= '０' && c <= '９') return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    return '-';
  });
}

/**
 * 7桁の数字だけを取り出す。桁数が合わなければ null。
 * 〒・ハイフン・空白は落とす。
 */
export function normalizePostalCode(v: string | null | undefined): string | null {
  if (!v) return null;
  const digits = toHalfWidth(v).replace(/[^0-9]/g, '');
  return digits.length === 7 ? digits : null;
}

/** 表示用の「105-0004」形式。7桁でなければそのまま返す。 */
export function formatPostalCode(v: string): string {
  const n = normalizePostalCode(v);
  return n ? `${n.slice(0, 3)}-${n.slice(3)}` : v;
}

export interface PostalAddress {
  /** 都道府県 */
  prefecture: string;
  /** 市区町村 */
  city: string;
  /** 町域（例: 新橋）。番地は含まない。 */
  town: string;
}

/** 外部APIの応答から必要な3つを取り出す（形が変わっても落ちないように検査する）。 */
export function parseZipcloud(json: unknown): PostalAddress | null {
  if (typeof json !== 'object' || json === null) return null;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const r = results[0] as Record<string, unknown>;
  const prefecture = typeof r.address1 === 'string' ? r.address1 : '';
  const city = typeof r.address2 === 'string' ? r.address2 : '';
  const town = typeof r.address3 === 'string' ? r.address3 : '';
  // 都道府県が取れないものは使い物にならない
  if (!prefecture) return null;
  return { prefecture, city, town };
}
