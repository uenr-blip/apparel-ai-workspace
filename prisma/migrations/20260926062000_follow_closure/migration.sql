ALTER TABLE "OrderMerchSheet" ADD COLUMN "factoryId" TEXT;
ALTER TABLE "OrderMerchSheet" ADD COLUMN "customerId" TEXT;
ALTER TABLE "OrderMerchStyle" ADD COLUMN "productionLineId" TEXT REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OrderMerchStyle_productionLineId_key" ON "OrderMerchStyle"("productionLineId");
CREATE TABLE "FollowChange" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "sheetId" TEXT NOT NULL,
  "status" TEXT NOT NULL, "reason" TEXT NOT NULL, "sourceReference" TEXT NOT NULL,
  "beforeJson" TEXT NOT NULL, "afterJson" TEXT NOT NULL, "impactJson" TEXT NOT NULL,
  "baseStamp" TEXT NOT NULL, "requestedBy" TEXT NOT NULL, "decidedBy" TEXT,
  "decisionNote" TEXT NOT NULL DEFAULT '', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "FollowChange_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "OrderMerchSheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FollowChange_organizationId_sheetId_status_idx" ON "FollowChange"("organizationId", "sheetId", "status");
CREATE TABLE "PatternHandoff" (
  "id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "sampleId" TEXT NOT NULL, "revisionId" TEXT NOT NULL, "styleVersionId" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PatternHandoff_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DevelopmentProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PatternHandoff_projectId_sampleId_key" ON "PatternHandoff"("projectId", "sampleId");
