import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dateInZone, formatMoney, TradeError } from "@/lib/trade-money";
import { resourcePage } from "./resource-scope";
import { billCte, billRow, cashCte, getContractRow, orderReceivableTotal, requireTrade, tradeOrder, type BillRow, type CashRow, type ContractRow } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import { billSource } from "./trade-bills";

export type TradeFilter = { q?: string; state?: string; projectId?: string; followRowId?: string; billId?: string; stageOnly?: string; currency?: string; direction?: string; orderId?: string; partyId?: string; page?: string | number; from?: string; to?: string };
export async function tradeToday(actor: TradeActor, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } });
  return dateInZone(now, org.timezone);
}
export function billWhere(filter: TradeFilter, today: string) {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (["receivable", "payable"].includes(filter.direction ?? "")) conditions.push(Prisma.sql`direction=${filter.direction}`);
  if (filter.orderId) conditions.push(Prisma.sql`orderId=${filter.orderId}`);
  if (filter.projectId) conditions.push(Prisma.sql`projectId=${filter.projectId}`);
  if (filter.followRowId) conditions.push(Prisma.sql`followRowId=${filter.followRowId}`);
  if (filter.stageOnly === "1") conditions.push(Prisma.sql`orderId IS NULL AND (projectId IS NOT NULL OR followRowId IS NOT NULL)`);
  if (filter.partyId) conditions.push(Prisma.sql`partyId=${filter.partyId}`);
  if (filter.currency) conditions.push(Prisma.sql`currency=${filter.currency}`);
  if (filter.from) conditions.push(Prisma.sql`dueDate>=${filter.from}`);
  if (filter.to) conditions.push(Prisma.sql`dueDate<=${filter.to}`);
  if (filter.state === "open") conditions.push(Prisma.sql`status='confirmed' AND openMinor>0`);
  else if (filter.state === "overdue") conditions.push(Prisma.sql`status='confirmed' AND openMinor>0 AND dueDate<${today}`);
  else if (filter.state === "settled") conditions.push(Prisma.sql`status='confirmed' AND openMinor=0`);
  else if (["draft", "confirmed", "void"].includes(filter.state ?? "")) conditions.push(Prisma.sql`status=${filter.state}`);
  const q = (filter.q ?? "").trim().slice(0, 100);
  if (q) conditions.push(Prisma.sql`instr(lower(orderNo || ' ' || partyName || ' ' || title),lower(${q}))>0`);
  return Prisma.join(conditions, " AND ");
}
export function cashWhere(filter: TradeFilter) {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (["receive", "pay"].includes(filter.direction ?? "")) conditions.push(Prisma.sql`direction=${filter.direction}`);
  if (filter.partyId) conditions.push(Prisma.sql`partyId=${filter.partyId}`);
  if (filter.currency) conditions.push(Prisma.sql`currency=${filter.currency}`);
  if (filter.from) conditions.push(Prisma.sql`occurredOn>=${filter.from}`);
  if (filter.to) conditions.push(Prisma.sql`occurredOn<=${filter.to}`);
  if (filter.state === "unallocated") conditions.push(Prisma.sql`status='recorded' AND availableMinor>0`);
  else if (["recorded", "void"].includes(filter.state ?? "")) conditions.push(Prisma.sql`status=${filter.state}`);
  const q = (filter.q ?? "").trim().slice(0, 100);
  if (q) conditions.push(Prisma.sql`instr(lower(bankReference || ' ' || bankAccount || ' ' || partyName),lower(${q}))>0`);
  return Prisma.join(conditions, " AND ");
}
export function billView(row: BillRow, today: string) {
  return { id: row.id, orderId: row.orderId, orderNo: row.orderNo, direction: row.direction, partyKind: row.partyKind, partyId: row.partyId, partyName: row.partyName,
    projectId: row.projectId, followRowId: row.followRowId, businessHref: row.orderId ? `/orders/${row.orderId}` : (row.subjectJson ? JSON.parse(row.subjectJson).href as string : "/finance?tab=payables"), expenseDate: row.expenseDate, expenseReference: row.expenseReference,
    title: row.title, category: row.category, currency: row.currency, originalAmount: formatMoney(row.amountMinor, row.currency), amount: formatMoney(row.totalMinor, row.currency),
    adjustment: formatMoney(row.adjustmentMinor, row.currency), allocatedAmount: formatMoney(row.allocatedMinor, row.currency), openAmount: formatMoney(row.openMinor, row.currency),
    dueDate: row.dueDate, basis: row.basis, sourceKind: row.sourceKind, sourceId: row.sourceId, packingPlanId: row.packingPlanId, status: row.status, version: Number(row.version), createdAt: row.createdAt,
    overdue: row.status === "confirmed" && row.openMinor > BigInt(0) && row.dueDate < today, settled: row.status === "confirmed" && row.openMinor === BigInt(0), voidReason: row.voidReason,
  };
}
export function cashView(row: CashRow) {
  return { id: row.id, cashKind:row.cashKind, treasuryId:row.treasuryId, refundedAmount:formatMoney(row.refundedMinor,row.currency), direction: row.direction, partyId: row.partyId, partyName: row.partyName, currency: row.currency, amount: formatMoney(row.amountMinor, row.currency), fee: formatMoney(row.feeMinor, row.currency),
    bankAmount: formatMoney(row.direction === "receive" ? row.amountMinor - row.feeMinor : row.amountMinor + row.feeMinor, row.currency),
    allocatedAmount: formatMoney(row.allocatedMinor, row.currency), unallocatedAmount: formatMoney(row.availableMinor, row.currency), bankAccount: row.bankAccount, bankReference: row.bankReference,
    occurredOn: row.occurredOn, basis: row.basis, status: row.status, version: Number(row.version), baseCurrency: row.baseCurrency,
    baseAmount: row.baseCurrency && row.baseAmountMinor !== null ? formatMoney(row.baseAmountMinor, row.baseCurrency) : null,
    exchangeRate: row.exchangeRate, rateDate: row.rateDate, rateSource: row.rateSource, voidReason: row.voidReason,
  };
}
export async function listTradeBills(actor: TradeActor, filter: TradeFilter = {}) {
  await requireTrade(actor); const today = await tradeToday(actor), page = resourcePage(filter.page), where = billWhere(filter, today), cte = billCte(actor.organizationId);
  const [counts, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) n FROM bills WHERE ${where}`),
    prisma.$queryRaw<BillRow[]>(Prisma.sql`${cte} SELECT * FROM bills WHERE ${where} ORDER BY dueDate,createdAt DESC,id LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  const total = Number(counts[0].n);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), today, rows: rows.map(row => billView(row, today)) };
}
export async function listTradeCash(actor: TradeActor, filter: TradeFilter = {}) {
  await requireTrade(actor); const page = resourcePage(filter.page), where = cashWhere(filter), cte = cashCte(actor.organizationId);
  const [counts, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) n FROM cash WHERE ${where}`),
    prisma.$queryRaw<CashRow[]>(Prisma.sql`${cte} SELECT * FROM cash WHERE ${where} ORDER BY occurredOn DESC,createdAt DESC,id LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  const total = Number(counts[0].n);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), rows: rows.map(cashView) };
}
export async function getTradeBill(actor: TradeActor, id: string, historyPage: string | number = 1) {
  await requireTrade(actor); const row = await billRow(prisma, actor.organizationId, id), today = await tradeToday(actor), offset = (resourcePage(historyPage) - 1) * 20;
  const [adjustments, allocations, counts, events] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string; amountMinor: bigint; reason: string; createdAt: string; actorName: string }>>`SELECT a.id,a.amountMinor,a.reason,a.createdAt,u.name actorName FROM TradeAdjustment a LEFT JOIN User u ON u.id=a.createdBy AND u.organizationId=a.organizationId WHERE a.organizationId=${actor.organizationId} AND a.billId=${id} ORDER BY a.createdAt DESC,a.id LIMIT 20 OFFSET ${offset}`,
    prisma.$queryRaw<Array<{ id: string; cashId: string; billAmountMinor: bigint; cashAmountMinor: bigint; cashCurrency: string; bankReference: string; exchangeRate: string; rateDate: string; rateSource: string; status: string; createdAt: string; reversalReason: string | null; actorName: string | null }>>`SELECT a.id,a.cashId,a.billAmountMinor,a.cashAmountMinor,c.currency cashCurrency,c.bankReference,a.exchangeRate,a.rateDate,a.rateSource,a.status,a.createdAt,a.reversalReason,u.name actorName FROM TradeAllocation a JOIN TradeCash c ON c.id=a.cashId AND c.organizationId=a.organizationId LEFT JOIN User u ON u.id=a.createdBy AND u.organizationId=a.organizationId WHERE a.organizationId=${actor.organizationId} AND a.billId=${id} ORDER BY a.createdAt DESC,a.id LIMIT 20 OFFSET ${offset}`,
    prisma.$queryRaw<Array<{ adjustments: bigint; allocations: bigint }>>`SELECT (SELECT COUNT(*) FROM TradeAdjustment WHERE organizationId=${actor.organizationId} AND billId=${id}) adjustments,(SELECT COUNT(*) FROM TradeAllocation WHERE organizationId=${actor.organizationId} AND billId=${id}) allocations`,
    prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: "TradeLedger", entityId: id }, select: { id: true, summary: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  let sourceChanged = false;
  if (row.sourceKind !== "manual") {
    try { sourceChanged = (await billSource(prisma, actor, row.orderId, row.sourceKind, row.sourceId!)).snapshot !== row.sourceSnapshot; }
    catch (error) { if (error instanceof TradeError) sourceChanged = true; else throw error; }
  }
  return { ...billView(row, today), sourceChanged, adjustments: adjustments.map(a => ({ id: a.id, amount: formatMoney(a.amountMinor, row.currency), reason: a.reason, createdAt: a.createdAt, actorName: a.actorName ?? "未留存" })),
    allocations: allocations.map(a => ({ id: a.id, cashId: a.cashId, billAmount: formatMoney(a.billAmountMinor, row.currency), cashAmount: formatMoney(a.cashAmountMinor, a.cashCurrency), cashCurrency: a.cashCurrency, bankReference: a.bankReference, exchangeRate: a.exchangeRate, rateDate: a.rateDate, rateSource: a.rateSource, status: a.status, createdAt: a.createdAt, reversalReason: a.reversalReason, actorName: a.actorName ?? "\u672a\u7559\u5b58" })),
    historyPage: resourcePage(historyPage), historyPageCount: Math.max(1, Math.ceil(Math.max(Number(counts[0].adjustments), Number(counts[0].allocations)) / 20)), events,
  };
}
export async function getTradeContract(actor: TradeActor, orderId: string) {
  await requireTrade(actor); const order = await tradeOrder(prisma, actor, orderId), row = await getContractRow(prisma, actor.organizationId, orderId);
  const planned = row ? await orderReceivableTotal(prisma, actor.organizationId, orderId) : BigInt(0);
  return { order: { id: order.id, orderNo: order.orderNo, customerName: order.customer.name, customerId: order.customerId, externalCustomerPo: order.externalCustomerPo },
    contract: row ? { id: row.id, plannedAmount: formatMoney(planned, row.currency), unplannedAmount: formatMoney(row.amountMinor - planned, row.currency), currency: row.currency, amount: formatMoney(row.amountMinor, row.currency), tradeMode: row.tradeMode, incoterm: row.incoterm, terms: row.terms, version: Number(row.version) } : null };
}
export async function listTradeContracts(actor: TradeActor, filter: TradeFilter = {}) {
  await requireTrade(actor); const page = resourcePage(filter.page), q = (filter.q ?? "").trim().slice(0, 100);
  const scope = Prisma.sql`FROM TradeContract t JOIN SalesOrder o ON o.id=t.orderId AND o.organizationId=t.organizationId JOIN Customer c ON c.id=o.customerId AND c.organizationId=t.organizationId WHERE t.organizationId=${actor.organizationId} ${q ? Prisma.sql`AND instr(lower(o.orderNo || ' ' || c.name),lower(${q}))>0` : Prisma.empty}`;
  const [counts, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),
    prisma.$queryRaw<Array<ContractRow & { orderNo: string; customerName: string }>>(Prisma.sql`SELECT t.*,o.orderNo,c.name customerName ${scope} ORDER BY t.updatedAt DESC,t.id LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  const total = Number(counts[0].n);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), rows: rows.map(row => ({ id: row.id, orderId: row.orderId, orderNo: row.orderNo, customerName: row.customerName, currency: row.currency, amount: formatMoney(row.amountMinor, row.currency), tradeMode: row.tradeMode, incoterm: row.incoterm, terms: row.terms, version: Number(row.version) })) };
}
export async function getTradeOverview(actor: TradeActor) {
  await requireTrade(actor); const today = await tradeToday(actor), org = actor.organizationId;
  const [bills, cash, counts, due, events] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ currency: string; receivable: bigint; payable: bigint; overdueReceive: bigint; overduePay: bigint }>>(Prisma.sql`${billCte(org)} SELECT currency,SUM(CASE WHEN direction='receivable' THEN openMinor ELSE 0 END) receivable,SUM(CASE WHEN direction='payable' THEN openMinor ELSE 0 END) payable,SUM(CASE WHEN direction='receivable' AND dueDate<${today} THEN openMinor ELSE 0 END) overdueReceive,SUM(CASE WHEN direction='payable' AND dueDate<${today} THEN openMinor ELSE 0 END) overduePay FROM bills WHERE status='confirmed' GROUP BY currency`),
    prisma.$queryRaw<Array<{ currency: string; received: bigint; paid: bigint; unallocatedReceive: bigint; unallocatedPay: bigint }>>(Prisma.sql`${cashCte(org)} SELECT currency,SUM(CASE WHEN direction='receive' THEN amountMinor ELSE 0 END) received,SUM(CASE WHEN direction='pay' THEN amountMinor ELSE 0 END) paid,SUM(CASE WHEN direction='receive' THEN availableMinor ELSE 0 END) unallocatedReceive,SUM(CASE WHEN direction='pay' THEN availableMinor ELSE 0 END) unallocatedPay FROM cash WHERE status='recorded' GROUP BY currency`),
    prisma.$queryRaw<Array<{ drafts: bigint; receivableDrafts: bigint; payableDrafts: bigint; documentsMissing: bigint; contracts: bigint }>>`SELECT (SELECT COUNT(*) FROM TradeBill WHERE organizationId=${org} AND status='draft') drafts,(SELECT COUNT(*) FROM TradeBill WHERE organizationId=${org} AND status='draft' AND direction='receivable') receivableDrafts,(SELECT COUNT(*) FROM TradeBill WHERE organizationId=${org} AND status='draft' AND direction='payable') payableDrafts,(SELECT COUNT(*) FROM TradeDocument WHERE organizationId=${org} AND status='active' AND storagePath IS NULL) documentsMissing,(SELECT COUNT(*) FROM TradeContract WHERE organizationId=${org}) contracts`,
    prisma.$queryRaw<BillRow[]>(Prisma.sql`${billCte(org)} SELECT * FROM bills WHERE status='confirmed' AND openMinor>0 ORDER BY dueDate,id LIMIT 6`),
    prisma.auditEvent.findMany({ where: { organizationId: org, entityType: "TradeLedger" }, select: { id: true, summary: true, createdAt: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const currencies = [...new Set([...bills.map(row => row.currency), ...cash.map(row => row.currency)])].sort().map(currency => {
    const b = bills.find(row => row.currency === currency), c = cash.find(row => row.currency === currency), f = (value?: bigint) => formatMoney(value ?? BigInt(0), currency);
    return { currency, receivable: f(b?.receivable), payable: f(b?.payable), overdueReceive: f(b?.overdueReceive), overduePay: f(b?.overduePay), received: f(c?.received), paid: f(c?.paid), unallocatedReceive: f(c?.unallocatedReceive), unallocatedPay: f(c?.unallocatedPay) };
  });
  return { currencies, today, drafts: Number(counts[0].drafts), receivableDrafts: Number(counts[0].receivableDrafts), payableDrafts: Number(counts[0].payableDrafts), documentsMissing: Number(counts[0].documentsMissing), contracts: Number(counts[0].contracts), due: due.map(row => billView(row, today)), events };
}

export async function listTradeDocuments(actor: TradeActor, filter: TradeFilter = {}) {
  await requireTrade(actor); const page = resourcePage(filter.page), q = (filter.q ?? "").trim().slice(0, 100);
  const scope = Prisma.sql`FROM TradeDocument d LEFT JOIN TradeBill b ON b.id=d.billId AND b.organizationId=d.organizationId LEFT JOIN SalesOrder o ON o.id=d.orderId AND o.organizationId=d.organizationId LEFT JOIN TradeCash c ON c.id=d.cashId AND c.organizationId=d.organizationId WHERE d.organizationId=${actor.organizationId}
    ${filter.orderId ? Prisma.sql`AND d.orderId=${filter.orderId}` : Prisma.empty}
    ${filter.billId ? Prisma.sql`AND d.billId=${filter.billId}` : Prisma.empty}
    ${filter.state === "void" ? Prisma.sql`AND d.status='void'` : Prisma.sql`AND d.status='active'`}
    ${filter.state === "missing" ? Prisma.sql`AND d.storagePath IS NULL` : Prisma.empty}
    ${q ? Prisma.sql`AND instr(lower(d.number || ' ' || COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label'),'') || ' ' || d.note),lower(${q}))>0` : Prisma.empty}`;
  const [counts, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),
    prisma.$queryRaw<Array<{ id: string; orderId: string | null; orderNo: string; kind: string; number: string; issuedOn: string; note: string; filename: string | null; bankReference: string | null; billId: string | null; cashId: string | null; packingPlanId: string | null; status: string; voidReason: string | null }>>(Prisma.sql`SELECT d.id,d.orderId,COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label'),'来源待核对') orderNo,d.kind,d.number,d.issuedOn,d.note,d.filename,c.bankReference,d.billId,d.cashId,d.packingPlanId,d.status,d.voidReason ${scope} ORDER BY d.issuedOn DESC,d.createdAt DESC,d.id LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  const total = Number(counts[0].n);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), rows };
}
