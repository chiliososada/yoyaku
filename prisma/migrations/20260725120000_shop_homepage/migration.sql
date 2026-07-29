-- 店舗の「専属ホームページ」（SEO公開ページ）。
-- ルート `/{slug}` で配信するため slug をグローバル一意にし、編集可能コンテンツを ShopProfile(1:1) に持つ。

-- 1) slug をグローバル一意に。
--    店舗作成は既にアプリ層でグローバル重複チェック済み（merchant createShop / platform onboarding）
--    のため、既存データに衝突はない想定。万一衝突があればこの CREATE は失敗するので、
--    その場合は手動でリネーム後に再実行すること。
CREATE UNIQUE INDEX "shops_slug_key" ON "shops"("slug");

-- 2) ShopProfile（Shop と 1:1）
-- CreateTable
CREATE TABLE "shop_profiles" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tagline" TEXT,
    "about" TEXT,
    "businessType" TEXT NOT NULL DEFAULT 'HealthAndBeautyBusiness',
    "heroImageKey" TEXT,
    "logoImageKey" TEXT,
    "gallery" JSONB NOT NULL DEFAULT '[]',
    "accessNote" TEXT,
    "themeColor" TEXT,
    "instagramUrl" TEXT,
    "lineUrl" TEXT,
    "xUrl" TEXT,
    "websiteUrl" TEXT,
    "homepageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "showMenu" BOOLEAN NOT NULL DEFAULT true,
    "showStaff" BOOLEAN NOT NULL DEFAULT true,
    "showGallery" BOOLEAN NOT NULL DEFAULT true,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_profiles_shopId_key" ON "shop_profiles"("shopId");

-- CreateIndex
CREATE INDEX "shop_profiles_tenantId_idx" ON "shop_profiles"("tenantId");

-- AddForeignKey
ALTER TABLE "shop_profiles" ADD CONSTRAINT "shop_profiles_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
