-- AlterTable
ALTER TABLE "OrganizationPolicy" ADD COLUMN "valueJson" TEXT NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "FactoryReconDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "factoryId" TEXT,
    "status" TEXT NOT NULL,
    "shippedQty" INTEGER NOT NULL,
    "unitPriceYuan" TEXT,
    "amountYuan" TEXT,
    "basisNote" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FactoryReconDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FactoryReconDraft_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FactoryReconDraft_organizationId_idempotencyKey_key" ON "FactoryReconDraft"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FactoryReconDraft_orderId_key" ON "FactoryReconDraft"("orderId");
