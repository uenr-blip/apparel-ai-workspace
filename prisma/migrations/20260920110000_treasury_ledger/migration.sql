-- CreateTable
CREATE TABLE "TreasuryRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "sourceCashId" TEXT NOT NULL,
    "counterCashId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "basis" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "voidReason" TEXT,
    CONSTRAINT "TreasuryRefund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TreasuryFx" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "sourceCashId" TEXT NOT NULL,
    "outCashId" TEXT NOT NULL,
    "inCashId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "fromMinor" BIGINT NOT NULL,
    "toMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "rate" TEXT NOT NULL,
    "rateDate" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "bankReference" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "voidReason" TEXT,
    CONSTRAINT "TreasuryFx_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TreasuryLeg" (
    "cashId" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "TreasuryLeg_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLBook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'demo',
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "GLBook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "GLAccount_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "GLBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "closeNote" TEXT,
    "closedBy" TEXT,
    "closedAt" TEXT,
    CONSTRAINT "GLPeriod_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "GLBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "number" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "sourceHash" TEXT,
    "sourceJson" TEXT,
    "expectedTotalMinor" BIGINT,
    "reversesId" TEXT,
    "reversedById" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TEXT,
    "postedBy" TEXT,
    "postedAt" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "GLJournal_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "GLBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "debitMinor" BIGINT NOT NULL,
    "creditMinor" BIGINT NOT NULL,
    "note" TEXT NOT NULL,
    CONSTRAINT "GLLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "GLJournal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GLLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GLAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GLSourceClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "activeKey" TEXT,
    CONSTRAINT "GLSourceClaim_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "GLBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "GLSourceClaim_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "GLJournal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryRefund_counterCashId_key" ON "TreasuryRefund"("counterCashId");

-- CreateIndex
CREATE INDEX "TreasuryRefund_organizationId_sourceCashId_status_idx" ON "TreasuryRefund"("organizationId", "sourceCashId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryFx_outCashId_key" ON "TreasuryFx"("outCashId");

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryFx_inCashId_key" ON "TreasuryFx"("inCashId");

-- CreateIndex
CREATE INDEX "TreasuryFx_organizationId_sourceCashId_status_idx" ON "TreasuryFx"("organizationId", "sourceCashId", "status");

-- CreateIndex
CREATE INDEX "TreasuryLeg_organizationId_ownerId_idx" ON "TreasuryLeg"("organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GLBook_organizationId_name_key" ON "GLBook"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "GLAccount_bookId_code_key" ON "GLAccount"("bookId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "GLPeriod_bookId_month_key" ON "GLPeriod"("bookId", "month");

-- CreateIndex
CREATE INDEX "GLJournal_bookId_date_status_idx" ON "GLJournal"("bookId", "date", "status");

-- CreateIndex
CREATE INDEX "GLJournal_bookId_reversesId_status_idx" ON "GLJournal"("bookId", "reversesId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GLJournal_bookId_number_key" ON "GLJournal"("bookId", "number");

-- CreateIndex
CREATE INDEX "GLLine_accountId_journalId_idx" ON "GLLine"("accountId", "journalId");

-- CreateIndex
CREATE UNIQUE INDEX "GLLine_journalId_lineNo_key" ON "GLLine"("journalId", "lineNo");

-- CreateIndex
CREATE INDEX "GLSourceClaim_sourceType_sourceId_idx" ON "GLSourceClaim"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "GLSourceClaim_bookId_activeKey_key" ON "GLSourceClaim"("bookId", "activeKey");
