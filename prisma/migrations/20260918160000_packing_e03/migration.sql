-- CreateTable
CREATE TABLE "PackingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalQty" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackingPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingCarton" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "cartonNo" TEXT NOT NULL,
    "netWeight" TEXT,
    "grossWeight" TEXT,
    "weightStatus" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "PackingCarton_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PackingPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingCartonLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cartonId" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "PackingCartonLine_cartonId_fkey" FOREIGN KEY ("cartonId") REFERENCES "PackingCarton" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PackingPlan_organizationId_idempotencyKey_key" ON "PackingPlan"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PackingCarton_planId_cartonNo_key" ON "PackingCarton"("planId", "cartonNo");
