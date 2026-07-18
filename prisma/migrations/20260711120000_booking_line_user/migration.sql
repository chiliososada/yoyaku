-- LINE 経由の予約で顧客の LINE userId を保持（確認/リマインドを LINE プッシュで送るため）。
ALTER TABLE "bookings" ADD COLUMN "customerLineUserId" TEXT;
