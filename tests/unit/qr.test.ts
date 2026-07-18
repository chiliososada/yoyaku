import { describe, it, expect } from 'vitest';
import { qrToSvg, qrToPngDataUrl } from '@/lib/qr';

describe('QR生成（予約ページ誘導用）', () => {
  const url = 'https://yoyaku.arcs-ai.com/book/demo-salon';

  it('SVG文字列を返す（ベクター表示・印刷用）', async () => {
    const svg = await qrToSvg(url);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).toContain('#0f172a'); // 濃色モジュール
  });

  it('高解像度 PNG の data URL を返す', async () => {
    const png = await qrToPngDataUrl(url, 256);
    expect(png.startsWith('data:image/png;base64,')).toBe(true);
    expect(png.length).toBeGreaterThan(500);
  });
});
