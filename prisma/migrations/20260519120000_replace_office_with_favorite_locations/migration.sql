-- AlterTable: drop defaultOffice column from User
ALTER TABLE "User" DROP COLUMN IF EXISTS "defaultOffice";

-- DropEnum
DROP TYPE IF EXISTS "OfficeLocation";

-- CreateTable
CREATE TABLE "FavoriteLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FavoriteLocation_userId_idx" ON "FavoriteLocation"("userId");

-- AddForeignKey
ALTER TABLE "FavoriteLocation" ADD CONSTRAINT "FavoriteLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
