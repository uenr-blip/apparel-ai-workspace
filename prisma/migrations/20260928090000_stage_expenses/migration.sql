-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TradeBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "projectId" TEXT,
    "followRowId" TEXT,
    "subjectJson" TEXT,
    "expenseDate" TEXT,
    "expenseReference" TEXT,
    "direction" TEXT NOT NULL,
    "partyKind" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "packingPlanId" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "sourceSnapshot" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "confirmedAt" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "TradeBill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeBill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeBill" ("amountMinor", "basis", "category", "confirmedAt", "createdAt", "createdBy", "currency", "direction", "dueDate", "id", "orderId", "organizationId", "packingPlanId", "partyId", "partyKind", "sourceId", "sourceKind", "sourceSnapshot", "status", "title", "version", "voidReason") SELECT "amountMinor", "basis", "category", "confirmedAt", "createdAt", "createdBy", "currency", "direction", "dueDate", "id", "orderId", "organizationId", "packingPlanId", "partyId", "partyKind", "sourceId", "sourceKind", "sourceSnapshot", "status", "title", "version", "voidReason" FROM "TradeBill";
DROP TABLE "TradeBill";
ALTER TABLE "new_TradeBill" RENAME TO "TradeBill";
CREATE INDEX "TradeBill_organizationId_direction_status_dueDate_idx" ON "TradeBill"("organizationId", "direction", "status", "dueDate");
CREATE INDEX "TradeBill_organizationId_orderId_idx" ON "TradeBill"("organizationId", "orderId");
CREATE INDEX "TradeBill_organizationId_sourceKind_sourceId_idx" ON "TradeBill"("organizationId", "sourceKind", "sourceId");
CREATE INDEX "TradeBill_organizationId_projectId_idx" ON "TradeBill"("organizationId", "projectId");
CREATE INDEX "TradeBill_organizationId_followRowId_idx" ON "TradeBill"("organizationId", "followRowId");
CREATE TABLE "new_TradeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issuedOn" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "billId" TEXT,
    "cashId" TEXT,
    "packingPlanId" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "storagePath" TEXT,
    "contentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "voidReason" TEXT,
    CONSTRAINT "TradeDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeDocument" ("billId", "cashId", "contentHash", "createdAt", "createdBy", "filename", "id", "issuedOn", "kind", "mimeType", "note", "number", "orderId", "organizationId", "packingPlanId", "status", "storagePath", "voidReason") SELECT "billId", "cashId", "contentHash", "createdAt", "createdBy", "filename", "id", "issuedOn", "kind", "mimeType", "note", "number", "orderId", "organizationId", "packingPlanId", "status", "storagePath", "voidReason" FROM "TradeDocument";
DROP TABLE "TradeDocument";
ALTER TABLE "new_TradeDocument" RENAME TO "TradeDocument";
CREATE INDEX "TradeDocument_organizationId_orderId_status_idx" ON "TradeDocument"("organizationId", "orderId", "status");
CREATE INDEX "TradeDocument_organizationId_kind_issuedOn_idx" ON "TradeDocument"("organizationId", "kind", "issuedOn");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

