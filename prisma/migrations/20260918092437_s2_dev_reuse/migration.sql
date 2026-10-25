-- CreateTable
CREATE TABLE "DevelopmentProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "styleId" TEXT,
    "sourceDocumentId" TEXT,
    "status" TEXT NOT NULL,
    "unknownsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DevelopmentProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentProject_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentProject_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DevelopmentCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "materialId" TEXT,
    "styleId" TEXT,
    "copyMode" TEXT NOT NULL,
    "unconfirmedJson" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    CONSTRAINT "DevelopmentCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DevelopmentProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentCandidate_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DevelopmentCandidate_styleId_fkey" FOREIGN KEY ("styleId") REFERENCES "Style" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeReuseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "candidateKind" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "matchMethod" TEXT NOT NULL,
    "matchReasonsJson" TEXT NOT NULL,
    "differencesJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rejectReason" TEXT,
    "adoptedProjectId" TEXT,
    "actorUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeReuseEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeReuseEvent_adoptedProjectId_fkey" FOREIGN KEY ("adoptedProjectId") REFERENCES "DevelopmentProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DevelopmentProject_organizationId_code_key" ON "DevelopmentProject"("organizationId", "code");
