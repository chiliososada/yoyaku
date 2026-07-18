'use client';

import { useEffect } from 'react';

/**
 * LIFF の一次リダイレクト受け（パス転送）。
 * `https://liff.line.me/{id}/book/{slug}` を開くと LINE はまず
 * `endpointURL/?liff.state=%2Fbook%2F{slug}`（= トップページ）へ遷移させる。
 * ここで liff.init() を呼ぶと SDK が自動ログインを完了させた上で liff.state の
 * パスへ二次リダイレクトする（正規フロー）。手動 replace だとログイン文脈が
 * 失われ、目的ページで isLoggedIn()=false → ループの原因になるため必ず SDK に任せる。
 * - liff.state が無い通常アクセスは no-op（SDK チャンクも読み込まない）。
 * - init 失敗時のみ相対パス限定で手動遷移（open redirect 拒否）。
 */
export function LiffStateRedirect({ liffId }: { liffId: string | null }) {
  useEffect(() => {
    const state = new URLSearchParams(window.location.search).get('liff.state');
    if (!state) return;
    const fallback = () => {
      // 同一オリジンの相対パスのみ許可。startsWith('/') 判定だけだと `/\evil.com` 等が
      // ブラウザにプロトコル相対 URL として解釈されるため、URL 解析で origin を厳密比較する。
      try {
        const u = new URL(state, window.location.origin);
        if (u.origin === window.location.origin) {
          window.location.replace(u.pathname + u.search + u.hash);
        }
      } catch {
        /* 不正な liff.state は無視（トップに留まる） */
      }
    };
    if (!liffId) {
      fallback();
      return;
    }
    void (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId }); // 完了時に SDK が liff.state へ遷移させる
      } catch {
        fallback();
      }
    })();
  }, [liffId]);
  return null;
}
