-- CreateTable
CREATE TABLE "Designer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Designer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Style" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "silhouette" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "demoNote" TEXT NOT NULL,
    "designerId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Style_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Style_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "Designer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Style" ("id", "organizationId", "code", "name", "category", "silhouette", "status", "imagePath", "demoNote", "createdAt")
SELECT "id", "organizationId", "code", "name", "category", "silhouette", "status", "imagePath", "demoNote", "createdAt" FROM "Style";
DROP TABLE "Style";
ALTER TABLE "new_Style" RENAME TO "Style";
CREATE UNIQUE INDEX "Style_organizationId_code_key" ON "Style"("organizationId", "code");

CREATE TABLE "new_SalesOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "factoryId" TEXT,
    "status" TEXT NOT NULL,
    "productionReadiness" TEXT NOT NULL,
    "externalCustomerPo" TEXT,
    "requestedDeliveryText" TEXT,
    "requestedDeliveryDate" TEXT,
    "deliveryYearInference" TEXT,
    "sourceDocumentId" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party" ("id") ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesOrder" ("id", "organizationId", "orderNo", "customerId", "factoryId", "status", "productionReadiness", "externalCustomerPo", "requestedDeliveryText", "requestedDeliveryDate", "deliveryYearInference", "sourceDocumentId", "notes", "createdAt", "updatedAt")
SELECT "id", "organizationId", "orderNo", "customerId", "factoryId", "status", "productionReadiness", "externalCustomerPo", "requestedDeliveryText", "requestedDeliveryDate", "deliveryYearInference", "sourceDocumentId", "notes", "createdAt", "updatedAt" FROM "SalesOrder";
DROP TABLE "SalesOrder";
ALTER TABLE "new_SalesOrder" RENAME TO "SalesOrder";
CREATE UNIQUE INDEX "SalesOrder_organizationId_orderNo_key" ON "SalesOrder"("organizationId", "orderNo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Designer_organizationId_name_key" ON "Designer"("organizationId", "name");
