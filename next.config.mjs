/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma / bcryptjs などサーバー専用パッケージを Server Components のバンドルから除外
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs', 'bullmq', 'ioredis', 'pino', 'nodemailer'],
  },
  // 本番デプロイ時は standalone 出力で軽量コンテナ化
  output: process.env.NEXT_OUTPUT_STANDALONE === 'true' ? 'standalone' : undefined,
  logging: {
    fetches: { fullUrl: false },
  },
};

export default nextConfig;
