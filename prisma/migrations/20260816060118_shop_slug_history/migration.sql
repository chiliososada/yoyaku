-- CreateTable
CREATE TABLE "shop_slug_history" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "releasedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_slug_history_slug_key" ON "shop_slug_history"("slug");

-- CreateIndex
CREATE INDEX "shop_slug_history_shopId_idx" ON "shop_slug_history"("shopId");

-- AddForeignKey
ALTER TABLE "shop_slug_history" ADD CONSTRAINT "shop_slug_history_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
