-- 住所の公開トグル（自宅サロン等のプライバシー保護。OFF でホームページ/JSON-LD/地図から住所を非表示）
ALTER TABLE "shop_profiles" ADD COLUMN "showAddress" BOOLEAN NOT NULL DEFAULT true;
