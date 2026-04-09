ALTER TABLE "User" ADD COLUMN "publicId" VARCHAR(7);

CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");