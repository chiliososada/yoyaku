-- 返金を課金台帳で表現できるようにする。
-- 手動で Stripe 側から返金しても台帳に痕跡が残らないと、SUM(amountJpy) が
-- 実収入より過大になり、MRR/LTV/デューデリの数字が静かに狂う。
--
-- 二重計上の防止:
--   charge.refunded は「1つの charge に返金が起きる度」に発火し、
--   charge.amount_refunded は**累計値**（3,000円→5,000円と分割返金すると 3,000 / 8,000 と届く）。
--   そこで単一返金の id を一意キーにして、DB 制約として二重計上を止める。
ALTER TYPE "BillingEventType" ADD VALUE 'PAYMENT_REFUNDED';

ALTER TABLE "billing_events" ADD COLUMN "stripeChargeId" TEXT;
ALTER TABLE "billing_events" ADD COLUMN "stripeRefundId" TEXT;

CREATE UNIQUE INDEX "billing_events_stripeRefundId_key" ON "billing_events"("stripeRefundId");
