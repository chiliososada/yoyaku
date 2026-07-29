-- 課金系通知（トライアル終了予告・督促・解約確認）を既存アウトボックスで送れるようにする。
--
-- 重複送信の防止方針:
--   日次スイープは「取りこぼしの自己修復」のため何度でも走る前提で作る。よって
--   コード側の慎重さではなく DB の一意制約で二重送信を止める（多重起動でも成立する）。
--   dedupeKey が NULL 同士は Postgres の一意制約では衝突しないため、既存の予約系通知
--   （dedupeKey = NULL）はこの制約の影響を受けない。
ALTER TYPE "NotificationTemplate" ADD VALUE 'TRIAL_ENDING_7';
ALTER TYPE "NotificationTemplate" ADD VALUE 'TRIAL_ENDING_3';
ALTER TYPE "NotificationTemplate" ADD VALUE 'TRIAL_ENDING_1';
ALTER TYPE "NotificationTemplate" ADD VALUE 'TRIAL_ENDED';
ALTER TYPE "NotificationTemplate" ADD VALUE 'BILLING_PAYMENT_FAILED';
ALTER TYPE "NotificationTemplate" ADD VALUE 'BILLING_PAYMENT_RECOVERED';
ALTER TYPE "NotificationTemplate" ADD VALUE 'BILLING_SUBSCRIPTION_CANCELED';

ALTER TABLE "notification_jobs" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "notification_jobs_tenantId_template_dedupeKey_key"
  ON "notification_jobs"("tenantId", "template", "dedupeKey");
