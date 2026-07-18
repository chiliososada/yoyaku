-- Stripe サブスクリプション課金の連携フィールド。
ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "tenants" ADD COLUMN "stripeSubscriptionStatus" TEXT;
ALTER TABLE "tenants" ADD COLUMN "currentPeriodEnd" TIMESTAMPTZ(6);
ALTER TABLE "tenants" ADD COLUMN "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "trialEndsAt" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants"("stripeCustomerId");

ALTER TABLE "plans" ADD COLUMN "stripePriceId" TEXT;

-- 既存テナントは課金免除でバックフィル（ロールアウト時に誰もロックアウトしない）。
-- 新規テナントは作成時に 30 日トライアルが付与される（アプリ側）。
UPDATE "tenants" SET "billingExempt" = true;
