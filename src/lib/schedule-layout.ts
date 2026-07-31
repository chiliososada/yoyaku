/**
 * スケジュールのタイムライン表示レイアウト（純関数）。
 */

/**
 * 同じレーンで時間が重なる予約を、上下の段（トラック）へ振り分ける。
 *
 * 段を分けないと、同時刻の予約は同じ座標に描かれて**最後の1件しか見えない**
 * （下敷きになった予約はクリックもできない＝その客は画面上存在しないのと同じ）。
 * 同時受付数を2以上にした店や、担当不要メニューの「未割当」レーンでは普通に起きる。
 *
 * 貪欲法: 開始時刻順に、空いている最初の段へ入れる。段数は重なりの最大数になる。
 */
export function assignTracks<T extends { startMin: number; endMin: number }>(
  blocks: T[],
): { blocks: (T & { track: number })[]; trackCount: number } {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const trackEnds: number[] = [];
  const out = sorted.map((b) => {
    // 終了 <= 開始 なら隣接（連続予約）なので同じ段に載せてよい
    let track = trackEnds.findIndex((end) => end <= b.startMin);
    if (track === -1) {
      track = trackEnds.length;
      trackEnds.push(b.endMin);
    } else {
      trackEnds[track] = b.endMin;
    }
    return { ...b, track };
  });
  return { blocks: out, trackCount: Math.max(1, trackEnds.length) };
}
