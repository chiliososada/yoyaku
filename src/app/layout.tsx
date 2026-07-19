import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';

const notoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Yoyaku | サロン・美容室の予約管理システム',
    template: '%s | Yoyaku',
  },
  description: '店舗・スタッフ・サービスを横断管理できる、商用グレードのマルチテナント予約管理システム「Yoyaku」。',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={cn(notoSansJp.variable, 'min-h-screen bg-background font-sans antialiased')}>
        {children}
      </body>
    </html>
  );
}
