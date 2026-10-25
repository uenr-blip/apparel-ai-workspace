-- CreateTable
CREATE TABLE "TradeBook" (
    "organizationId" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TradeBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "TradeOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeContract" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "tradeMode" TEXT NOT NULL,
    "incoterm" TEXT NOT NULL,
    "terms" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    CONSTRAINT "TradeContract_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeContract_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "TradeCash" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "partyKind" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "bankAccount" TEXT NOT NULL,
    "bankReference" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "baseCurrency" TEXT,
    "baseAmountMinor" BIGINT,
    "exchangeRate" TEXT,
    "rateDate" TEXT,
    "rateSource" TEXT,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "voidReason" TEXT,
    CONSTRAINT "TradeCash_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeAllocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "cashId" TEXT NOT NULL,
    "billAmountMinor" BIGINT NOT NULL,
    "cashAmountMinor" BIGINT NOT NULL,
    "exchangeRate" TEXT NOT NULL,
    "rateDate" TEXT NOT NULL,
    "rateSource" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "reversedBy" TEXT,
    "reversedAt" TEXT,
    "reversalReason" TEXT,
    CONSTRAINT "TradeAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "TradeBill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeAllocation_cashId_fkey" FOREIGN KEY ("cashId") REFERENCES "TradeCash" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "TradeAdjustment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeAdjustment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "TradeBill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "TradeOperation_organizationId_idempotencyKey_key" ON "TradeOperation"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TradeContract_orderId_key" ON "TradeContract"("orderId");

-- CreateIndex
CREATE INDEX "TradeContract_organizationId_updatedAt_idx" ON "TradeContract"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "TradeBill_organizationId_direction_status_dueDate_idx" ON "TradeBill"("organizationId", "direction", "status", "dueDate");

-- CreateIndex
CREATE INDEX "TradeBill_organizationId_orderId_idx" ON "TradeBill"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "TradeBill_organizationId_sourceKind_sourceId_idx" ON "TradeBill"("organizationId", "sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "TradeCash_organizationId_direction_status_occurredOn_idx" ON "TradeCash"("organizationId", "direction", "status", "occurredOn");

-- CreateIndex
CREATE INDEX "TradeCash_organizationId_bankAccount_bankReference_idx" ON "TradeCash"("organizationId", "bankAccount", "bankReference");

-- CreateIndex
CREATE INDEX "TradeCash_organizationId_partyKind_partyId_idx" ON "TradeCash"("organizationId", "partyKind", "partyId");

-- CreateIndex
CREATE INDEX "TradeAllocation_organizationId_billId_status_idx" ON "TradeAllocation"("organizationId", "billId", "status");

-- CreateIndex
CREATE INDEX "TradeAllocation_organizationId_cashId_status_idx" ON "TradeAllocation"("organizationId", "cashId", "status");

-- CreateIndex
CREATE INDEX "TradeAdjustment_organizationId_billId_idx" ON "TradeAdjustment"("organizationId", "billId");

-- CreateIndex
CREATE INDEX "TradeDocument_organizationId_orderId_status_idx" ON "TradeDocument"("organizationId", "orderId", "status");

-- CreateIndex
CREATE INDEX "TradeDocument_organizationId_kind_issuedOn_idx" ON "TradeDocument"("organizationId", "kind", "issuedOn");
