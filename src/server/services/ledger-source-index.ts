import { Prisma } from "@prisma/client";

// Expressions below are fixed server constants, never request-provided SQL.
function object(fields: Record<string, string>): Prisma.Sql {
  return Prisma.sql`json_object(${Prisma.join(Object.entries(fields).map(([key, expression]) => Prisma.sql`${key},${Prisma.raw(expression)}`))})`;
}
const billFacts = (adjustment: boolean) => object({
  type: adjustment ? "'adjustment'" : "'bill'", id: adjustment ? "a.id" : "b.id", billId: "b.id", status: "b.status",
  direction: "b.direction", partyId: "b.partyId", currency: "b.currency", originalAmount: "CAST(b.amountMinor AS TEXT)", title: "b.title",
  adjustment: adjustment ? "json_object('id',a.id,'amount',CAST(a.amountMinor AS TEXT),'reason',a.reason,'createdAt',a.createdAt)" : "NULL",
});
const cashFacts = (refund: boolean) => object({
  type: refund ? "'refund'" : "'cash'", id: refund ? "r.id" : "c.id",
  refund: refund ? "json_object('id',r.id,'sourceCashId',r.sourceCashId,'counterCashId',r.counterCashId,'status',r.status,'basis',r.basis)" : "NULL",
  cashId: "c.id", direction: "c.direction", partyKind: "c.partyKind", partyId: "c.partyId", currency: "c.currency",
  amount: "CAST(c.amountMinor AS TEXT)", fee: "CAST(c.feeMinor AS TEXT)", account: "c.bankAccount", reference: "c.bankReference", occurredOn: "c.occurredOn", status: "c.status",
});
const fxFacts = object({
  type: "'fx'", id: "f.id", status: "f.status", sourceCashId: "f.sourceCashId", outCashId: "f.outCashId", inCashId: "f.inCashId",
  fromCurrency: "f.fromCurrency", toCurrency: "f.toCurrency", fromMinor: "CAST(f.fromMinor AS TEXT)", toMinor: "CAST(f.toMinor AS TEXT)", feeMinor: "CAST(f.feeMinor AS TEXT)",
  rate: "f.rate", rateDate: "f.rateDate", occurredOn: "f.occurredOn", reference: "f.bankReference", basis: "f.basis",
});

/** Canonical sources only: treasury-generated cash legs belong to their group. */
export function ledgerSourceIndex(org: string, bookId: string, changedBillIds: string[] = []) {
  const affected = changedBillIds.length ? Prisma.sql`s.billId IN (${Prisma.join(changedBillIds)})` : Prisma.sql`0`;
  return Prisma.sql`WITH RECURSIVE
    cash_edges(parentId,childId) AS (
      SELECT sourceCashId,counterCashId FROM TreasuryRefund WHERE organizationId=${org}
      UNION SELECT sourceCashId,outCashId FROM TreasuryFx WHERE organizationId=${org}
      UNION SELECT sourceCashId,inCashId FROM TreasuryFx WHERE organizationId=${org}
    ),
    cash_orders(cashId,orderId) AS (
      SELECT a.cashId,b.orderId FROM TradeAllocation a JOIN TradeBill b ON b.id=a.billId AND b.organizationId=a.organizationId
      WHERE a.organizationId=${org} AND a.status='active' AND b.status='confirmed'
      UNION SELECT e.childId,o.orderId FROM cash_edges e JOIN cash_orders o ON o.cashId=e.parentId
    ),
    sources AS (
      SELECT 'bill' type,b.id,b.id billId,b.title label,b.currency,b.amountMinor,b.createdAt occurredOn,
        b.orderId,COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label')),NULL cashId,b.status businessStatus,${billFacts(false)} facts
      FROM TradeBill b LEFT JOIN SalesOrder o ON o.id=b.orderId AND o.organizationId=b.organizationId WHERE b.organizationId=${org}
      UNION ALL
      SELECT 'adjustment',a.id,b.id,b.title||' · '||a.reason,b.currency,a.amountMinor,a.createdAt,b.orderId,COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label')),NULL,b.status,${billFacts(true)}
      FROM TradeAdjustment a JOIN TradeBill b ON b.id=a.billId AND b.organizationId=a.organizationId
      LEFT JOIN SalesOrder o ON o.id=b.orderId AND o.organizationId=b.organizationId WHERE a.organizationId=${org}
      UNION ALL
      SELECT 'cash',c.id,NULL,c.bankReference,c.currency,c.amountMinor,c.occurredOn,NULL,NULL,c.id,c.status,${cashFacts(false)}
      FROM TradeCash c WHERE c.organizationId=${org} AND NOT EXISTS(SELECT 1 FROM TreasuryLeg l WHERE l.cashId=c.id AND l.organizationId=c.organizationId)
      UNION ALL
      SELECT 'refund',r.id,NULL,c.bankReference,c.currency,r.amountMinor,c.occurredOn,NULL,NULL,c.id,
        CASE WHEN r.status='active' THEN c.status ELSE 'void' END,${cashFacts(true)}
      FROM TreasuryRefund r JOIN TradeCash c ON c.id=r.counterCashId AND c.organizationId=r.organizationId WHERE r.organizationId=${org}
      UNION ALL
      SELECT 'fx',f.id,NULL,f.bankReference,f.fromCurrency,f.fromMinor,f.occurredOn,NULL,NULL,f.sourceCashId,
        CASE WHEN f.status='active' THEN 'recorded' ELSE 'void' END,${fxFacts}
      FROM TreasuryFx f WHERE f.organizationId=${org}
    ),
    bridge AS (
      SELECT s.*,j.id journalId,j.number journalNumber,j.status journalStatus,j.reversedById,
        CASE
          WHEN ${affected} THEN 'changed'
          WHEN s.businessStatus='draft' THEN 'unconfirmed'
          WHEN s.businessStatus NOT IN ('confirmed','recorded') THEN 'inactive'
          WHEN claim.id IS NOT NULL AND (j.sourceJson IS NULL OR json_extract(j.sourceJson,'$.facts')<>s.facts) THEN 'changed'
          WHEN claim.id IS NOT NULL AND EXISTS(SELECT 1 FROM GLJournal r WHERE r.bookId=${bookId} AND r.reversesId=j.id AND r.status IN ('draft','reviewed')) THEN 'reversing'
          WHEN claim.id IS NOT NULL THEN j.status
          WHEN j.reversedById IS NOT NULL THEN 'reversed'
          ELSE 'ready' END state,
        CASE WHEN ${affected} THEN '业务依据已变化，先核对来源及应付差异'
          WHEN claim.id IS NOT NULL AND (j.sourceJson IS NULL OR json_extract(j.sourceJson,'$.facts')<>s.facts) THEN '制单来源与当前记录不同，须核对原凭证'
          ELSE NULL END issue
      FROM sources s
      LEFT JOIN GLSourceClaim claim ON claim.bookId=${bookId} AND claim.activeKey=s.type||':'||s.id
      LEFT JOIN GLJournal j ON j.bookId=${bookId} AND j.id=COALESCE(claim.journalId,
        (SELECT h.id FROM GLJournal h WHERE h.bookId=${bookId} AND h.sourceType=s.type AND h.sourceId=s.id ORDER BY h.createdAt DESC,h.id DESC LIMIT 1))
    )`;
}
