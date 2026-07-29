-- 公開セルフサーブ登録の申込テーブル。
-- メール検証が済むまでテナントを作らないための保留領域（未検証の登録でテナント表が汚れるのを防ぐ）。
-- パスワードは bcrypt ハッシュのみ、送信元 IP もハッシュのみを保持する。
CREATE TABLE "signup_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "tenantId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_requests_pkey" PRIMARY KEY ("id")
);

-- トークンは一意（同じリンクで二重にテナントを作らせない）
CREATE UNIQUE INDEX "signup_requests_tokenHash_key" ON "signup_requests"("tokenHash");
-- レート制限の集計に使う
CREATE INDEX "signup_requests_email_createdAt_idx" ON "signup_requests"("email", "createdAt");
CREATE INDEX "signup_requests_ipHash_createdAt_idx" ON "signup_requests"("ipHash", "createdAt");
