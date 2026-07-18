-- ログインセキュリティ: アカウントロック（連続失敗）+ メールOTPの二段階認証。
ALTER TABLE "users" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockedUntil" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN "loginOtpHash" TEXT;
ALTER TABLE "users" ADD COLUMN "loginOtpExpiresAt" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN "loginOtpAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "twoFactorExempt" BOOLEAN NOT NULL DEFAULT false;

-- デモアカウント（@demo.test は実メールボックスを持たない検証用）のみ 2FA 免除。
UPDATE "users" SET "twoFactorExempt" = true WHERE "email" LIKE '%@demo.test';
