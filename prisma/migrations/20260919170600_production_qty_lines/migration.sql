-- CreateTable
CREATE TABLE "ProductionQtyLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productionQtyId" TEXT NOT NULL,
    "colorName" TEXT NOT NULL,
    "sizeCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "ProductionQtyLine_productionQtyId_fkey" FOREIGN KEY ("productionQtyId") REFERENCES "ProductionQty" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
