-- CreateTable
CREATE TABLE "MaterialReceipt" (
    "inboundLotId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "purchaseDraftId" TEXT,
    "reference" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "qtyMilli" BIGINT NOT NULL,
    "currency" TEXT,
    "unitPriceMicros" BIGINT,
    "valuationVersion" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "basis" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "MaterialReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialValuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "unitPriceMicros" BIGINT NOT NULL,
    "basis" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "MaterialValuation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialValuation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaterialReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialLotOrigin" (
    "lotId" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    CONSTRAINT "MaterialLotOrigin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialLotOrigin_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaterialReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialUse" (
    "movementId" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "receiptId" TEXT,
    "orderId" TEXT,
    "qtyMilli" BIGINT NOT NULL,
    "currency" TEXT,
    "unitPriceMicros" BIGINT,
    "basis" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "MaterialUse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialUse_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaterialReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaterialEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "receiptId" TEXT,
    "useId" TEXT,
    "kind" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "qtyMilli" BIGINT NOT NULL,
    "reversesId" TEXT,
    "transferId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "basis" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "MaterialEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MaterialEvent_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaterialReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderCostTag" (
    "billId" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "basis" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "OrderCostTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReceipt_lotId_key" ON "MaterialReceipt"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReceipt_movementId_key" ON "MaterialReceipt"("movementId");

-- CreateIndex
CREATE INDEX "MaterialReceipt_organizationId_orderId_status_idx" ON "MaterialReceipt"("organizationId", "orderId", "status");

-- CreateIndex
CREATE INDEX "MaterialReceipt_organizationId_purchaseDraftId_idx" ON "MaterialReceipt"("organizationId", "purchaseDraftId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialReceipt_organizationId_reference_key" ON "MaterialReceipt"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialValuation_receiptId_version_key" ON "MaterialValuation"("receiptId", "version");

-- CreateIndex
CREATE INDEX "MaterialLotOrigin_organizationId_receiptId_idx" ON "MaterialLotOrigin"("organizationId", "receiptId");

-- CreateIndex
CREATE INDEX "MaterialUse_organizationId_orderId_idx" ON "MaterialUse"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "MaterialUse_organizationId_receiptId_idx" ON "MaterialUse"("organizationId", "receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialEvent_movementId_key" ON "MaterialEvent"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialEvent_reversesId_key" ON "MaterialEvent"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialEvent_transferId_key" ON "MaterialEvent"("transferId");

-- CreateIndex
CREATE INDEX "MaterialEvent_organizationId_receiptId_kind_status_idx" ON "MaterialEvent"("organizationId", "receiptId", "kind", "status");

-- CreateIndex
CREATE INDEX "MaterialEvent_organizationId_useId_kind_status_idx" ON "MaterialEvent"("organizationId", "useId", "kind", "status");

-- CreateIndex
CREATE INDEX "OrderCostTag_organizationId_active_idx" ON "OrderCostTag"("organizationId", "active");
