'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, QrCode as QrIcon, Image as ImageIcon, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  shopName: string;
  bookingUrl: string;
  slug: string;
  qrSvg: string;
  qrPng: string; // data URL
  /** LINE ネイティブ予約の入口（LIFF 未設定なら null → LINE 区画は非表示） */
  lineBookingUrl?: string | null;
  lineQrSvg?: string | null;
  lineQrPng?: string | null;
}

/** ポスターの配色・文言テーマ（ウェブ予約 / LINE 予約） */
interface PosterTheme {
  bgTop: string;
  accent: string;
  headline: string;
  scanText: string;
  pills: string[];
  pillBg: string;
  pillFg: string;
}

const WEB_THEME: PosterTheme = {
  bgTop: '#eef2ff',
  accent: '#4f46e5',
  headline: 'ネットで24時間かんたんご予約',
  scanText: 'QRコードを読み取ってご予約',
  pills: ['24時間受付', 'スマホ対応', '登録不要'],
  pillBg: '#eef2ff',
  pillFg: '#4338ca',
};

const LINE_THEME: PosterTheme = {
  bgTop: '#e6f9ee',
  accent: '#06C755',
  headline: 'LINEでかんたんご予約',
  scanText: 'QRコードを読み取ってLINEでご予約',
  pills: ['入力不要でスグ予約', '確認・リマインドもLINE', '24時間受付'],
  pillBg: '#e6f9ee',
  pillFg: '#067d3d',
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 集客ポスター(PNG)を canvas に描画。1080x1350（印刷・SNS 両対応の 4:5）。 */
function drawPoster(
  ctx: CanvasRenderingContext2D,
  opts: { shopName: string; url: string; qr: HTMLImageElement; theme: PosterTheme },
) {
  const { theme } = opts;
  const W = 1080;
  const H = 1350;
  const cx = W / 2;

  // 背景（テーマ色→白のグラデ）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.bgTop);
  bg.addColorStop(1, '#ffffff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // フローティングカード
  const cardX = 90;
  const cardY = 110;
  const cardW = W - cardX * 2;
  const cardH = H - cardY - 110;
  ctx.save();
  ctx.shadowColor = 'rgba(30,41,59,0.18)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cardX, cardY, cardW, cardH, 44);
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';

  // 店名
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 58px sans-serif';
  ctx.fillText(truncate(opts.shopName, 16), cx, cardY + 120);

  // サブ見出し
  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(theme.headline, cx, cardY + 178);

  // QR を白い枠に載せる
  const qrSize = 560;
  const qrX = cx - qrSize / 2;
  const qrY = cardY + 232;
  ctx.save();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  roundRect(ctx, qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 28);
  ctx.stroke();
  ctx.restore();
  ctx.drawImage(opts.qr, qrX, qrY, qrSize, qrSize);

  // 読み取り案内
  ctx.fillStyle = '#334155';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(theme.scanText, cx, qrY + qrSize + 78);

  // URL
  ctx.fillStyle = '#94a3b8';
  ctx.font = '24px sans-serif';
  ctx.fillText(opts.url.replace(/^https?:\/\//, ''), cx, qrY + qrSize + 124);

  // フッターのバッジ
  ctx.font = 'bold 24px sans-serif';
  const gap = 20;
  const padX = 26;
  const widths = theme.pills.map((p) => ctx.measureText(p).width + padX * 2);
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (theme.pills.length - 1);
  let px = cx - totalW / 2;
  const py = cardY + cardH - 74;
  theme.pills.forEach((p, i) => {
    ctx.fillStyle = theme.pillBg;
    roundRect(ctx, px, py, widths[i]!, 48, 24);
    ctx.fill();
    ctx.fillStyle = theme.pillFg;
    ctx.fillText(p, px + widths[i]! / 2, py + 32);
    px += widths[i]! + gap;
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** ポスター生成＋プレビュー＋ダウンロード（1テーマ分） */
function PosterCard({
  shopName,
  url,
  qrPng,
  theme,
  filename,
  caption,
}: {
  shopName: string;
  url: string;
  qrPng: string;
  theme: PosterTheme;
  filename: string;
  caption: string;
}) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const posterBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = 1350;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      drawPoster(ctx, { shopName, url, qr: img, theme });
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        posterBlobRef.current = blob;
        setPosterUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      }, 'image/png');
    };
    img.src = qrPng;
    return () => {
      cancelled = true;
    };
  }, [shopName, url, qrPng, theme]);

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-2xl border bg-slate-50 shadow-sm">
        {posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl} alt="予約ポスター" className="block w-full" />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center text-sm text-muted-foreground">
            生成中…
          </div>
        )}
      </div>
      <Button
        onClick={() => {
          if (posterBlobRef.current) downloadBlob(posterBlobRef.current, filename);
        }}
        disabled={!posterUrl}
        className="w-full"
      >
        <ImageIcon className="size-4" /> ポスターをダウンロード（PNG）
      </Button>
      <p className="text-center text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/** URL 表示＋コピー */
function UrlCopyRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard 不可（http 等）は無視 */
    }
  };
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{url}</span>
      <button
        onClick={copyUrl}
        className="flex shrink-0 items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs hover:bg-slate-50"
      >
        {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
        {copied ? 'コピー済み' : 'コピー'}
      </button>
    </div>
  );
}

export function QrMaterial({
  shopName,
  bookingUrl,
  slug,
  qrSvg,
  qrPng,
  lineBookingUrl,
  lineQrSvg,
  lineQrPng,
}: Props) {
  const dlPng = async (dataUrl: string, filename: string) => {
    const res = await fetch(dataUrl);
    downloadBlob(await res.blob(), filename);
  };
  const dlSvg = (svg: string, filename: string) => {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), filename);
  };

  const hasLine = Boolean(lineBookingUrl && lineQrSvg && lineQrPng);

  return (
    <div className="grid gap-10">
      {/* ─── ウェブ予約 QR ─── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <PosterCard
          shopName={shopName}
          url={bookingUrl}
          qrPng={qrPng}
          theme={WEB_THEME}
          filename={`${slug}-yoyaku-poster.png`}
          caption="店頭掲示・SNS・チラシにそのまま使えます（1080×1350）"
        />

        <div className="grid content-start gap-4">
          <div className="flex flex-wrap items-center gap-5 rounded-2xl border bg-white p-5">
            <div
              className="size-40 shrink-0 [&>svg]:size-full"
              aria-label="予約ページQR"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <QrIcon className="size-4 text-primary" /> ウェブ予約 QR コード
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                スキャンすると、この店舗の予約画面がブラウザで開きます。
              </p>
              <UrlCopyRow url={bookingUrl} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => dlPng(qrPng, `${slug}-yoyaku-qr.png`)}>
              <Download className="size-4" /> QR画像（PNG）
            </Button>
            <Button variant="outline" onClick={() => dlSvg(qrSvg, `${slug}-yoyaku-qr.svg`)}>
              <Download className="size-4" /> QR画像（SVG・印刷用）
            </Button>
          </div>

          <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">使い方のヒント</p>
            <ul className="grid gap-1">
              <li>・ポスターPNGを印刷して受付やレジ横に掲示。</li>
              <li>・SVGは拡大しても劣化しないので、大きなチラシ・看板に。</li>
              <li>・Instagram / LINE のプロフィールに URL を貼っても予約できます。</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ─── LINE 予約 QR（LIFF 設定時のみ） ─── */}
      {hasLine && (
        <div className="grid gap-6 border-t pt-8 lg:grid-cols-[minmax(0,340px)_1fr]">
          <PosterCard
            shopName={shopName}
            url={lineBookingUrl!}
            qrPng={lineQrPng!}
            theme={LINE_THEME}
            filename={`${slug}-line-yoyaku-poster.png`}
            caption="LINE ユーザー向け。入力不要・通知も LINE に届きます"
          />

          <div className="grid content-start gap-4">
            <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-[#06C755]/40 bg-[#06C755]/5 p-5">
              <div
                className="size-40 shrink-0 [&>svg]:size-full"
                aria-label="LINE予約QR"
                dangerouslySetInnerHTML={{ __html: lineQrSvg! }}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <MessageCircle className="size-4 text-[#06C755]" /> LINE 予約 QR コード
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  スキャンすると LINE 内で予約画面が開きます。お客様は氏名・メールの入力不要、
                  予約確認・リマインドは LINE のトークに届きます（no-show 削減に効果的）。
                </p>
                <UrlCopyRow url={lineBookingUrl!} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => dlPng(lineQrPng!, `${slug}-line-yoyaku-qr.png`)}>
                <Download className="size-4" /> QR画像（PNG）
              </Button>
              <Button variant="outline" onClick={() => dlSvg(lineQrSvg!, `${slug}-line-yoyaku-qr.svg`)}>
                <Download className="size-4" /> QR画像（SVG・印刷用）
              </Button>
            </div>

            <div className="rounded-xl border border-dashed border-[#06C755]/40 bg-[#06C755]/5 p-4 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">LINE 予約のメリット</p>
              <ul className="grid gap-1">
                <li>・お客様は入力不要（LINE の名前で即予約）→ 予約完了率が上がります。</li>
                <li>・確認とリマインドが LINE に届くため、メールより開封率が高く no-show を減らせます。</li>
                <li>・予約時に公式アカウントの友だち追加を促せます（再来店の接点に）。</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
