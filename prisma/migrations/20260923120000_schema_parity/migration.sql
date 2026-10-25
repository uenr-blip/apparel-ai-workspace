-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN "storagePath" TEXT;

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "demoNote" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "Season_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleSeason" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "styleId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    CONSTRAINT "StyleSeason_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StyleOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StyleOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleOption_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StyleOption" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "optionCode" TEXT NOT NULL,
    "qty" TEXT NOT NULL,
    "amountYuan" TEXT NOT NULL,
    "allocatedFree" TEXT NOT NULL,
    "reservedInbound" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseDraft_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseDraft_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderMerchSheet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "seasonCode" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "factoryName" TEXT NOT NULL DEFAULT '',
    "craftFamily" TEXT NOT NULL DEFAULT '',
    "salesSampleJson" TEXT NOT NULL DEFAULT '{}',
    "bulkJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderMerchSheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderMerchSheet_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderMerchStyle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sheetId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,
    "styleCode" TEXT NOT NULL DEFAULT '',
    "styleName" TEXT NOT NULL DEFAULT '',
    "craftFamily" TEXT NOT NULL DEFAULT '',
    "imagePath" TEXT NOT NULL DEFAULT '',
    "labDipJson" TEXT NOT NULL DEFAULT '{}',
    "salesSampleJson" TEXT NOT NULL DEFAULT '{}',
    "bulkJson" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "OrderMerchStyle_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "OrderMerchSheet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "intent" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "styleId" TEXT,
    "materialId" TEXT,
    "developmentProjectId" TEXT,
    "sourceDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignProject_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DesignProject_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DesignProject_developmentProjectId_fkey" FOREIGN KEY ("developmentProjectId") REFERENCES "DevelopmentProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DesignProject_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DesignProject_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "instruction" TEXT NOT NULL DEFAULT '',
    "referenceJson" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roundId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignVariant_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DesignRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DevelopmentProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "styleId" TEXT,
    "sourceDocumentId" TEXT,
    "status" TEXT NOT NULL,
    "unknownsJson" TEXT NOT NULL,
    "craftFamily" TEXT NOT NULL DEFAULT '',
    "sheetJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DevelopmentProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentProject_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentProject_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DevelopmentProject" ("code", "createdAt", "customerId", "id", "name", "organizationId", "sourceDocumentId", "status", "styleId", "unknownsJson", "updatedAt") SELECT "code", "createdAt", "customerId", "id", "name", "organizationId", "sourceDocumentId", "status", "styleId", "unknownsJson", "updatedAt" FROM "DevelopmentProject";
DROP TABLE "DevelopmentProject";
ALTER TABLE "new_DevelopmentProject" RENAME TO "DevelopmentProject";
CREATE UNIQUE INDEX "DevelopmentProject_organizationId_code_key" ON "DevelopmentProject"("organizationId", "code");
CREATE TABLE "new_InventoryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ownerKind" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "qtyOnHand" TEXT NOT NULL,
    "qtyAllocated" TEXT NOT NULL,
    "qtyInbound" TEXT NOT NULL DEFAULT '0',
    "qualityStatus" TEXT NOT NULL,
    "availableFrom" TEXT NOT NULL,
    "inboundEta" TEXT,
    "inboundNo" TEXT,
    "demoNote" TEXT NOT NULL,
    CONSTRAINT "InventoryLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryLot_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryLot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InventoryLot" ("availableFrom", "colorName", "demoNote", "id", "inboundEta", "inboundNo", "locationId", "materialId", "organizationId", "ownerKind", "qtyAllocated", "qtyOnHand", "qualityStatus") SELECT "availableFrom", "colorName", "demoNote", "id", "inboundEta", "inboundNo", "locationId", "materialId", "organizationId", "ownerKind", "qtyAllocated", "qtyOnHand", "qualityStatus" FROM "InventoryLot";
DROP TABLE "InventoryLot";
ALTER TABLE "new_InventoryLot" RENAME TO "InventoryLot";
CREATE TABLE "new_Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "specSummary" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL DEFAULT '',
    "composition" TEXT NOT NULL DEFAULT '',
    "gsm" TEXT NOT NULL DEFAULT '',
    "widthCm" TEXT NOT NULL DEFAULT '',
    "createdByUserId" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL DEFAULT '',
    "demoNote" TEXT NOT NULL,
    CONSTRAINT "Material_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Material" ("code", "demoNote", "id", "kind", "name", "organizationId", "specSummary", "unit") SELECT "code", "demoNote", "id", "kind", "name", "organizationId", "specSummary", "unit" FROM "Material";
DROP TABLE "Material";
ALTER TABLE "new_Material" RENAME TO "Material";
CREATE UNIQUE INDEX "Material_organizationId_code_key" ON "Material"("organizationId", "code");
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
    CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesOrder" ("createdAt", "createdByUserId", "customerId", "deliveryYearInference", "externalCustomerPo", "factoryId", "id", "notes", "orderNo", "organizationId", "productionReadiness", "requestedDeliveryDate", "requestedDeliveryText", "sourceDocumentId", "status", "updatedAt") SELECT "createdAt", "createdByUserId", "customerId", "deliveryYearInference", "externalCustomerPo", "factoryId", "id", "notes", "orderNo", "organizationId", "productionReadiness", "requestedDeliveryDate", "requestedDeliveryText", "sourceDocumentId", "status", "updatedAt" FROM "SalesOrder";
DROP TABLE "SalesOrder";
ALTER TABLE "new_SalesOrder" RENAME TO "SalesOrder";
CREATE UNIQUE INDEX "SalesOrder_organizationId_orderNo_key" ON "SalesOrder"("organizationId", "orderNo");
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
    "brandOptionId" TEXT,
    "categoryOptionId" TEXT,
    "typeOptionId" TEXT,
    "yearOptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Style_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Style_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "Designer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_brandOptionId_fkey" FOREIGN KEY ("brandOptionId") REFERENCES "StyleOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_categoryOptionId_fkey" FOREIGN KEY ("categoryOptionId") REFERENCES "StyleOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_typeOptionId_fkey" FOREIGN KEY ("typeOptionId") REFERENCES "StyleOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Style_yearOptionId_fkey" FOREIGN KEY ("yearOptionId") REFERENCES "StyleOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Style" ("category", "code", "createdAt", "createdByUserId", "demoNote", "designerId", "id", "imagePath", "name", "organizationId", "silhouette", "status") SELECT "category", "code", "createdAt", "createdByUserId", "demoNote", "designerId", "id", "imagePath", "name", "organizationId", "silhouette", "status" FROM "Style";
DROP TABLE "Style";
ALTER TABLE "new_Style" RENAME TO "Style";
CREATE UNIQUE INDEX "Style_organizationId_code_key" ON "Style"("organizationId", "code");
CREATE TABLE "new_StyleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "styleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "cuffType" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "specNotes" TEXT NOT NULL DEFAULT '',
    "processNotes" TEXT NOT NULL DEFAULT '',
    "patternRevision" TEXT NOT NULL DEFAULT '',
    "sourceDocumentId" TEXT,
    "approvedAt" DATETIME,
    "approvedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StyleVersion_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StyleVersion" ("approvedAt", "approvedByName", "changeSummary", "createdAt", "cuffType", "id", "patternRevision", "processNotes", "sourceDocumentId", "status", "styleId", "versionNumber") SELECT "approvedAt", "approvedByName", "changeSummary", "createdAt", "cuffType", "id", "patternRevision", "processNotes", "sourceDocumentId", "status", "styleId", "versionNumber" FROM "StyleVersion";
DROP TABLE "StyleVersion";
ALTER TABLE "new_StyleVersion" RENAME TO "StyleVersion";
CREATE UNIQUE INDEX "StyleVersion_styleId_versionNumber_key" ON "StyleVersion"("styleId", "versionNumber");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "factoryId" TEXT,
    "avatarPath" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_factoryId_fkey" FOREIGN KEY ("factoryId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "email", "factoryId", "id", "name", "organizationId", "passwordHash", "role") SELECT "active", "createdAt", "email", "factoryId", "id", "name", "organizationId", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Season_organizationId_code_key" ON "Season"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StyleSeason_styleId_seasonId_key" ON "StyleSeason"("styleId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDraft_orderId_materialId_key" ON "PurchaseDraft"("orderId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDraft_organizationId_idempotencyKey_key" ON "PurchaseDraft"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderMerchSheet_salesOrderId_key" ON "OrderMerchSheet"("salesOrderId");

-- CreateIndex
CREATE INDEX "OrderMerchStyle_sheetId_idx" ON "OrderMerchStyle"("sheetId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignProject_organizationId_code_key" ON "DesignProject"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DesignRound_projectId_versionNumber_key" ON "DesignRound"("projectId", "versionNumber");
