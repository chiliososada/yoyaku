'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** サーバー側 MAX_UPLOAD_BYTES と揃える（先に手元で弾いて、無駄な往復と待ち時間を無くす）。 */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * 画像のドラッグ＆ドロップ。
 *
 * ブラウザの既定動作では、ページのどこかに画像を落とすとその画像へ**画面遷移**してしまう。
 * 編集途中のホームページ設定は未保存なので、狙いを外して落としただけで入力が全部消える。
 * そこでウィンドウ全体で既定動作を止めたうえで、ドロップ領域だけが受け取る。
 */
export function useImageDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [over, setOver] = useState(false);
  // dragenter/leave は子要素をまたぐたびに発火するので、深さを数えないとチラつく
  const depth = useRef(0);

  // ドロップ領域の外に落としても画面遷移させない（未保存の入力を失わせない）
  useEffect(() => {
    const stop = (e: DragEvent) => {
      // ファイルのドラッグだけを対象にする（テキスト選択のドラッグ等は邪魔しない）
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);

  const reset = useCallback(() => {
    depth.current = 0;
    setOver(false);
  }, []);

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (disabled || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (disabled || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      // コピー扱いにするとカーソルが「＋」になり、落として良いことが伝わる
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      depth.current -= 1;
      if (depth.current <= 0) reset();
    },
    onDrop: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      reset();
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
  };

  return { over, handlers };
}

/**
 * 落とされたファイルを検査し、受け取れるものと理由付きの拒否メッセージに分ける。
 * 黙って無視すると「落としたのに何も起きない」になり、原因が分からない。
 */
export function screenImageFiles(files: File[]): { accepted: File[]; error: string | null } {
  const accepted: File[] = [];
  const notImage: string[] = [];
  const tooBig: string[] = [];

  for (const f of files) {
    if (!f.type.startsWith('image/')) {
      notImage.push(f.name);
      continue;
    }
    if (f.size > MAX_IMAGE_BYTES) {
      tooBig.push(f.name);
      continue;
    }
    accepted.push(f);
  }

  const msgs: string[] = [];
  if (notImage.length > 0) {
    msgs.push(`画像ファイルではありません: ${notImage.slice(0, 3).join('・')}${notImage.length > 3 ? ' ほか' : ''}`);
  }
  if (tooBig.length > 0) {
    msgs.push(`12MBを超えています: ${tooBig.slice(0, 3).join('・')}${tooBig.length > 3 ? ' ほか' : ''}`);
  }
  return { accepted, error: msgs.length > 0 ? msgs.join(' / ') : null };
}
