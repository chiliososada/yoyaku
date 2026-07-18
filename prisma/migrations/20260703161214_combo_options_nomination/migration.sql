-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "nominationFeeJpy" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "nominationFeeJpy" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "service_options" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceJpy" INTEGER NOT NULL DEFAULT 0,
    "extraDurationMin" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "service_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_item_options" (
    "id" TEXT NOT NULL,
    "bookingItemId" TEXT NOT NULL,
    "optionId" TEXT,
    "name" TEXT NOT NULL,
    "priceJpy" INTEGER NOT NULL DEFAULT 0,
    "extraDurationMin" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_options_serviceId_isActive_idx" ON "service_options"("serviceId", "isActive");

-- CreateIndex
CREATE INDEX "booking_item_options_bookingItemId_idx" ON "booking_item_options"("bookingItemId");

-- AddForeignKey
ALTER TABLE "service_options" ADD CONSTRAINT "service_options_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item_options" ADD CONSTRAINT "booking_item_options_bookingItemId_fkey" FOREIGN KEY ("bookingItemId") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_item_options" ADD CONSTRAINT "booking_item_options_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "service_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;
