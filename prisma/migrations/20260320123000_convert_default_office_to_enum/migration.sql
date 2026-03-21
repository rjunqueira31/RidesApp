CREATE TYPE "OfficeLocation" AS ENUM ('LISBON', 'PORTO', 'BRAGA');

ALTER TABLE "User"
ADD COLUMN "defaultOffice_next" "OfficeLocation";

UPDATE "User"
SET "defaultOffice_next" = CASE
  WHEN "defaultOffice" IS NULL THEN NULL
  WHEN LOWER(TRIM("defaultOffice")) IN ('lisbon', 'lisbon office') THEN 'LISBON'::"OfficeLocation"
  WHEN LOWER(TRIM("defaultOffice")) IN ('porto', 'porto office') THEN 'PORTO'::"OfficeLocation"
  WHEN LOWER(TRIM("defaultOffice")) IN ('braga', 'braga office') THEN 'BRAGA'::"OfficeLocation"
  ELSE NULL
END;

ALTER TABLE "User"
DROP COLUMN "defaultOffice";

ALTER TABLE "User"
RENAME COLUMN "defaultOffice_next" TO "defaultOffice";