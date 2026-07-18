/**
 * QR コード生成（サーバー専用）。予約ページ URL を集客物料に使うために SVG / PNG を作る。
 * 誤り訂正レベル M（印刷汚れ・軽い遮蔽に強い）、高コントラスト（濃紺 on 白）でスキャン確実性を確保。
 */
import QRCode from 'qrcode';

const DARK = '#0f172a'; // slate-900（ほぼ黒。白背景とのコントラスト十分）
const LIGHT = '#ffffff';

/** URL を QR の SVG 文字列に。画面表示・ベクター(印刷)ダウンロード用。 */
export function qrToSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: DARK, light: LIGHT },
  });
}

/** URL を高解像度 PNG の data URL に。PNG ダウンロード・ポスター合成(canvas)用。 */
export function qrToPngDataUrl(text: string, width = 1024): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width,
    color: { dark: DARK, light: LIGHT },
  });
}
