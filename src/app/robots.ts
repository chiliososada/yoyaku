import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // アプリ内部・管理系はクロール不要（公開ホームページ /{slug} は許可）
        disallow: ['/admin', '/platform', '/api/', '/login', '/forgot-password', '/reset-password', '/booking/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
