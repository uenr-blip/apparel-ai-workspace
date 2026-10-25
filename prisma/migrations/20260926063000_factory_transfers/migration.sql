CREATE TABLE "FactoryTransfer" (
"receivedAt" DATETIME, "receivedBy" TEXT, "receiptNote" TEXT NOT NULL DEFAULT '',
"id" TEXT NOT NULL PRIMARY KEY, "organizationId" TEXT NOT NULL, "orderId" TEXT NOT NULL,
"fromFactoryId" TEXT NOT NULL, "toFactoryId" TEXT NOT NULL, "status" TEXT NOT NULL,
"reason" TEXT NOT NULL, "sourceReference" TEXT NOT NULL, "selectionJson" TEXT NOT NULL,
"beforeJson" TEXT NOT NULL, "afterJson" TEXT NOT NULL DEFAULT '{}', "baseStamp" TEXT NOT NULL,
"requestedBy" TEXT NOT NULL, "reviewedBy" TEXT, "reviewNote" TEXT NOT NULL DEFAULT '',
"decidedBy" TEXT, "decisionNote" TEXT NOT NULL DEFAULT '', "newOrderId" TEXT,
"idempotencyKey" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "FactoryTransfer_organizationId_idempotencyKey_key" ON "FactoryTransfer"("organizationId", "idempotencyKey");
CREATE INDEX "FactoryTransfer_organizationId_orderId_status_idx" ON "FactoryTransfer"("organizationId", "orderId", "status");
CREATE INDEX "FactoryTransfer_organizationId_fromFactoryId_idx" ON "FactoryTransfer"("organizationId", "fromFactoryId");
CREATE INDEX "FactoryTransfer_organizationId_toFactoryId_idx" ON "FactoryTransfer"("organizationId", "toFactoryId");
