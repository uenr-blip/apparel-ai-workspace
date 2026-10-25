-- AlterTable
ALTER TABLE "StyleVersion" ADD COLUMN "processNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StyleVersion" ADD COLUMN "patternRevision" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "StyleVersionAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "styleVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StyleVersionAttachment_styleVersionId_fkey" FOREIGN KEY ("styleVersionId") REFERENCES "StyleVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
