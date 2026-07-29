-- 通知配信の信頼性向上。
--
-- 1) maxAttempts 既定を 5 → 9 に。
--    バックオフは 2/4/8/16/30/30/30/30 分（notification-service.ts）なので、
--    5 回では合計 30 分しか耐えられず、LINE/SMTP の 30〜60 分障害で通知が
--    FAILED のまま永久に失われる。9 回で計 150 分をカバーする。
--    既存の PENDING 行にも新しい猶予を与えるため、未送信分は引き上げる。
ALTER TABLE "notification_jobs" ALTER COLUMN "maxAttempts" SET DEFAULT 9;

UPDATE "notification_jobs"
SET "maxAttempts" = 9
WHERE "status" IN ('PENDING', 'PROCESSING') AND "maxAttempts" = 5;

-- 2) bookingId の索引。
--    予約のキャンセル/改期で未送信リマインドを CANCELLED にする updateMany が
--    この列で絞り込む。改期は advisory lock を保持したまま実行されるため、
--    索引が無いと店舗×日のロック保持時間が伸びる。
CREATE INDEX "notification_jobs_bookingId_idx" ON "notification_jobs"("bookingId");
