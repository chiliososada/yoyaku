# ============================================================================
# 本番用アプリイメージ（マルチステージ / Next.js standalone 出力）
#   Web:    docker build -t booking-saas .
#   Worker: docker build -t booking-saas-worker --target worker .
#   インフラ(PostgreSQL/Redis)は compose 側。マイグレーションはデプロイ手順で実行。
# ============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
# Prisma が必要とする openssl
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_OUTPUT_STANDALONE=true
ENV NEXT_TELEMETRY_DISABLED=1
# ビルド時のみのダミー値（env.ts の検証を通すため。実行時は compose の env が上書き）
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV AUTH_SECRET="build-time-only-secret-not-used-at-runtime"
ENV APP_BASE_URL="http://localhost:3000"
# Prisma Client 生成 + 本番ビルド
RUN npx prisma generate && npm run build

# ---- 通知ワーカー（BullMQ）。tsx 実行のためフル依存 + ソースを保持 ----
FROM node:20-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
USER app
CMD ["npx", "tsx", "src/server/queue/worker.ts"]

# ---- Web 本体（standalone） ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app

# standalone 出力 + 静的アセット + Prisma スキーマ/エンジン
COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# sharp（店舗ホームページの画像最適化）: standalone のトレースが musl バイナリを
# 取りこぼす場合があるため、依存を明示コピーして実行時の欠落を防ぐ。
COPY --from=deps --chown=app:app /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps --chown=app:app /app/node_modules/@img ./node_modules/@img
# uploads マウントポイントを app 所有で用意（空の名前付きボリューム初期化時に所有権が伝播。
# これが無いと root 所有のボリュームに非rootの app が書けず、画像アップロードが EACCES で全滅する）
RUN mkdir -p /app/uploads && chown app:app /app/uploads

USER app
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
