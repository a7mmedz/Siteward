-- Who made the last successful write to each inspection. "updatedAt" already exists and is set
-- by the server on every write.

-- AddColumn (nullable first so existing rows can be backfilled)
ALTER TABLE "Inspection" ADD COLUMN "updatedById" UUID;

-- Backfill: there is no edit history, so the owner (the inspector) is the best known author.
UPDATE "Inspection" SET "updatedById" = "inspectorId" WHERE "updatedById" IS NULL;

ALTER TABLE "Inspection" ALTER COLUMN "updatedById" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
