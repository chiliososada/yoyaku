-- 課金の追記専用イベントログ。MRR推移・解約率・コホートの一次情報源。
--
-- 背景: これまで契約状態は subscriptions を externalRef で upsert する「現在状態」しか
-- 持っておらず、trial→active→past_due→canceled の遷移が互いを上書きして履歴が残らなかった。
-- 加えて金額は plans.priceJpy との JOIN でしか復元できず、価格を改定すると過去の MRR が
-- 遡って書き換わる構造だった（=買い手に提示できる収益履歴が作れない）。
-- 課金顧客が 0 件の今のうちに、発生時点の金額・プランをスナップショットする台帳を用意する。

-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM (
  'TRIAL_STARTED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'PLAN_CHANGED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'SUBSCRIPTION_CANCELED'
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "BillingEventType" NOT NULL,
    "planId" TEXT,
    "planCode" TEXT,
    "planName" TEXT,
    "amountJpy" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'jpy',
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "stripeEventId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeInvoiceId" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex（Webhook 再送の冪等キー。NULL は複数許容＝内部発火イベント用）
CREATE UNIQUE INDEX "billing_events_stripeEventId_key" ON "billing_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "billing_events_tenantId_occurredAt_idx" ON "billing_events"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "billing_events_type_occurredAt_idx" ON "billing_events"("type", "occurredAt");

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
