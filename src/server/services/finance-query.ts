import { Prisma } from "@prisma/client";

export const FINANCE_STATES = { missing: "待生成草稿", basis: "待补计价依据", changed: "出运或工厂已变化", review: "记录需检查", saved: "已有草稿" } as const;
export type FinanceState = keyof typeof FINANCE_STATES;
export type FinanceFilter = { q?: string; page?: string | number; state?: string; factoryId?: string };

// Shared classification keeps overview links and paginated detail counts consistent.
export function financeCte(organizationId: string) {
  return Prisma.sql`WITH quantities AS (
    SELECT p.orderId, SUM(CASE WHEN p.kind = 'good' THEN p.quantity ELSE 0 END) good,
      SUM(CASE WHEN p.kind = 'shipped' THEN p.quantity ELSE 0 END) shipped
    FROM ProductionQty p JOIN SalesOrder o ON o.id = p.orderId
    WHERE o.organizationId = ${organizationId} AND p.kind IN ('good','shipped') GROUP BY p.orderId
  ), source AS (
    SELECT o.id, o.orderNo, o.updatedAt, o.factoryId, c.name customerName, f.name factoryName,
      d.id draftId, d.status draftStatus, d.paid, d.shippedQty savedQty, d.factoryId savedFactoryId,
      df.name savedFactoryName, d.amountYuan, d.unitPriceYuan, d.basisNote,
      COALESCE(q.good,0) good, COALESCE(q.shipped,0) shipped,
      CASE WHEN d.status = 'draft' AND d.paid = 0 AND length(d.amountYuan) BETWEEN 4 AND 15
        AND substr(d.amountYuan,-3,1) = '.'
        AND substr(d.amountYuan,1,length(d.amountYuan)-3) NOT GLOB '*[^0-9]*'
        AND substr(d.amountYuan,-2) NOT GLOB '*[^0-9]*'
        THEN CAST(replace(d.amountYuan,'.','') AS INTEGER) ELSE NULL END cents
    FROM SalesOrder o
    JOIN Customer c ON c.id = o.customerId AND c.organizationId = o.organizationId
    LEFT JOIN Party f ON f.id = o.factoryId AND f.organizationId = o.organizationId
    LEFT JOIN FactoryReconDraft d ON d.orderId = o.id AND d.organizationId = o.organizationId
    LEFT JOIN Party df ON df.id = d.factoryId AND df.organizationId = o.organizationId
    LEFT JOIN quantities q ON q.orderId = o.id
    WHERE o.organizationId = ${organizationId} AND (COALESCE(q.shipped,0) > 0 OR d.id IS NOT NULL)
  ), finance AS (
    SELECT *, CASE
      WHEN paid = 1 OR factoryName IS NULL OR shipped <= 0 OR shipped > good THEN 'review'
      WHEN draftId IS NULL THEN 'missing'
      WHEN draftStatus = 'needs_basis' OR amountYuan IS NULL OR unitPriceYuan IS NULL OR trim(COALESCE(basisNote,'')) = '' THEN 'basis'
      WHEN cents IS NULL THEN 'review'
      WHEN savedQty <> shipped OR savedFactoryId IS NOT factoryId THEN 'changed'
      ELSE 'saved' END state
    FROM source
  )`;
}

export function financeWhere(filter: FinanceFilter) {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];
  const q = (filter.q ?? "").trim().slice(0, 100);
  if (q) conditions.push(Prisma.sql`(instr(lower(orderNo),lower(${q})) > 0 OR instr(lower(customerName),lower(${q})) > 0 OR instr(lower(COALESCE(factoryName,'')),lower(${q})) > 0)`);
  if (filter.state === "pending") conditions.push(Prisma.sql`state <> 'saved'`);
  else if (filter.state && Object.hasOwn(FINANCE_STATES, filter.state)) conditions.push(Prisma.sql`state = ${filter.state}`);
  if (filter.factoryId) conditions.push(Prisma.sql`savedFactoryId = ${filter.factoryId.slice(0, 120)}`);
  return Prisma.join(conditions, " AND ");
}

export function centsToYuan(cents: string) {
  const value = BigInt(cents);
  return `${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
