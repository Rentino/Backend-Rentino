-- Provider-controlled listing availability (#54)
-- `isActive` stays the admin/archive flag; `availability` lets a provider take a
-- listing off the market (UNAVAILABLE) or pause it for maintenance (MAINTENANCE)
-- without deleting it or losing its order history.

-- CreateEnum
CREATE TYPE "GearAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'MAINTENANCE');

-- AlterTable
ALTER TABLE "GearItem"
    ADD COLUMN "availability" "GearAvailability" NOT NULL DEFAULT 'AVAILABLE',
    ADD COLUMN "unavailableReason" TEXT;

-- CreateIndex
CREATE INDEX "GearItem_availability_idx" ON "GearItem"("availability");
