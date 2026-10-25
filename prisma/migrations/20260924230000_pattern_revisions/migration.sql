-- CreateTable
CREATE TABLE "PatternRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "parentId" TEXT,
    "craftFamily" TEXT NOT NULL,
    "sheetJson" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatternRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DevelopmentProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatternSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "factoryId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dueDate" TEXT NOT NULL DEFAULT '',
    "requirements" TEXT NOT NULL DEFAULT '',
    "quoteJson" TEXT NOT NULL DEFAULT '{}',
    "feedbackJson" TEXT NOT NULL DEFAULT '{}',
    "internalOpinion" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT NOT NULL,
    "issuedAt" DATETIME,
    "issuedById" TEXT,
    "receivedAt" DATETIME,
    "receivedById" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatternSample_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DevelopmentProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PatternSample_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PatternRevision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PatternRevision_projectId_number_key" ON "PatternRevision"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PatternSample_projectId_factoryId_round_key" ON "PatternSample"("projectId", "factoryId", "round");

