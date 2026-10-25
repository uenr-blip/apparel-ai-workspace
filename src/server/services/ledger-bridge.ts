import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney, TradeError } from "@/lib/trade-money";
import { requireLedger, ledgerBook } from "./ledger-db";
import { requireTrade, tradeOrder } from "./trade-db";
import { resourcePage } from "./resource-scope";
import { ledgerSourceIndex } from "./ledger-source-index";
import { changedBusinessBills } from "./ledger-business-check";
import type { TradeActor } from "./trade-contract";

export const BRIDGE_STATES = { ready: "待制单", draft: "凭证草稿", reviewed: "待过账", posted: "已过账", reversing: "冲销处理中", reversed: "已冲销 · 待重新核对", changed: "来源待核对", unconfirmed: "业务待确认", inactive: "来源已失效" };
export const SOURCE_TYPES = { bill: "应收应付原单", adjustment: "独立扣补", cash: "原始收付款", refund: "退款", fx: "结汇 / 换汇" };
export type BridgeFilter = { orderId?: string; billId?: string; type?: string; sourceId?: string; q?: string; state?: string; page?: string | number };
type Row = { type: string; id: string; billId: string | null; label: string; currency: string; amountMinor: bigint; occurredOn: string; orderId: string | null; orderNo: string | null; cashId: string | null; businessStatus: string; facts: string; journalId: string | null; journalNumber: string | null; journalStatus: string | null; reversedById: string | null; state: keyof typeof BRIDGE_STATES; issue: string | null };
export function sourceBridgeHref(type: string, id: string, bookId?: string) {
  return `/finance/sources/${encodeURIComponent(type)}/${encodeURIComponent(id)}${bookId ? `?bookId=${encodeURIComponent(bookId)}` : ""}`;
}
function conditions(filter: BridgeFilter, withState = true) {
  const values: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (filter.orderId) values.push(Prisma.sql`(orderId=${filter.orderId} OR EXISTS(SELECT 1 FROM cash_orders co WHERE co.cashId=bridge.cashId AND co.orderId=${filter.orderId}))`);
  if (filter.billId) values.push(Prisma.sql`billId=${filter.billId}`);
  if (filter.sourceId) values.push(Prisma.sql`id=${filter.sourceId}`);
  if (filter.type) {
    if (!(filter.type in SOURCE_TYPES)) throw new TradeError("不支持的业务来源");
    values.push(Prisma.sql`type=${filter.type}`);
  }
  const q = (filter.q ?? "").trim().slice(0, 100);
  if (q) values.push(Prisma.sql`instr(lower(label||' '||COALESCE(orderNo,'')||' '||id),lower(${q}))>0`);
  if (withState && filter.state === "unprepared") values.push(Prisma.sql`state IN ('ready','reversed')`);
  else if (withState && filter.state === "pending") values.push(Prisma.sql`state IN ('ready','draft','reviewed','reversing','reversed','changed')`);
  else if (withState && filter.state && filter.state in BRIDGE_STATES) values.push(Prisma.sql`state=${filter.state}`);
  return Prisma.join(values, " AND ");
}
function view(row: Row, issues: Map<string, string>) {
  const issue = issues.get(row.billId ?? "") ?? row.issue;
  return { ...row, amountMinor: undefined, amount: formatMoney(row.amountMinor, row.currency), issue,
    href: sourceBridgeHref(row.type, row.id), businessHref: row.billId ? `/finance/bills/${encodeURIComponent(row.billId)}` :
      row.type === "cash" ? `/finance?tab=cash&q=${encodeURIComponent(row.label)}` : `/finance?tab=treasury&view=${row.type === "fx" ? "fx" : "refund"}&q=${encodeURIComponent(row.label)}`,
    canPrepare: ["ready", "reversed"].includes(row.state),
  };
}
export async function listLedgerBridge(actor: TradeActor, bookId: string, filter: BridgeFilter = {}) {
  await requireTrade(actor); await requireLedger(actor);
  const book = await ledgerBook(prisma, actor.organizationId, bookId);
  if (filter.orderId) await tradeOrder(prisma, actor, filter.orderId);
  let checkBillId = filter.billId;
  if (filter.type === "adjustment" && filter.sourceId) {
    const [a] = await prisma.$queryRaw<Array<{billId:string}>>`SELECT billId FROM TradeAdjustment WHERE organizationId=${actor.organizationId} AND id=${filter.sourceId}`;
    checkBillId = a?.billId ?? "__missing__";
  }
  const issues = filter.type && ["cash","refund","fx"].includes(filter.type) ? new Map<string,string>() : await changedBusinessBills(prisma, actor, filter.orderId, checkBillId);
  const cte = ledgerSourceIndex(actor.organizationId, book.id, [...issues.keys()]), where = conditions(filter), base = conditions(filter, false), page = resourcePage(filter.page);
  const [counts, states, rows] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) n FROM bridge WHERE ${where}`),
    prisma.$queryRaw<Array<{ state: keyof typeof BRIDGE_STATES; n: bigint }>>(Prisma.sql`${cte} SELECT state,COUNT(*) n FROM bridge WHERE ${base} GROUP BY state`),
    prisma.$queryRaw<Row[]>(Prisma.sql`${cte} SELECT * FROM bridge WHERE ${where} ORDER BY occurredOn DESC,type,id LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  return { book, page, total: Number(counts[0].n), pageCount: Math.max(1, Math.ceil(Number(counts[0].n) / 20)),
    counts: Object.fromEntries(states.map(r => [r.state, Number(r.n)])), rows: rows.map(r => view(r, issues)) };
}
export async function getLedgerSourceBridge(actor: TradeActor, bookId: string, type: string, id: string, pageInput?: string) {
  // Narrow bill checks on detail pages. Cash / treasury sources have no upstream bill.
  const data = await listLedgerBridge(actor, bookId, { type, sourceId: id, billId: type === "bill" ? id : undefined });
  const source = data.rows[0];
  if (!source) throw new TradeError("业务来源不存在或不属于当前组织", 404);
  const page = resourcePage(pageInput), org = actor.organizationId;
  const scope = Prisma.sql`FROM GLJournal j JOIN GLBook b ON b.id=j.bookId
    WHERE b.organizationId=${org} AND b.id=${bookId} AND
      ((j.sourceType=${type} AND j.sourceId=${id}) OR j.reversesId IN (SELECT id FROM GLJournal WHERE bookId=${bookId} AND sourceType=${type} AND sourceId=${id}))`;
  const [count, history, orders] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),
    prisma.$queryRaw<Array<{ id: string; number: string | null; status: string; date: string; summary: string; reversesId: string | null }>>(Prisma.sql`SELECT j.id,j.number,j.status,j.date,j.summary,j.reversesId ${scope} ORDER BY j.createdAt DESC,j.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`),
    prisma.$queryRaw<Array<{ id: string; orderNo: string }>>(Prisma.sql`${ledgerSourceIndex(org, bookId)}
      SELECT o.id,o.orderNo FROM SalesOrder o WHERE o.organizationId=${org} AND
      (o.id=${source.orderId ?? ""} OR EXISTS(SELECT 1 FROM cash_orders co WHERE co.cashId=${source.cashId ?? ""} AND co.orderId=o.id)) ORDER BY o.orderNo LIMIT 101`),
  ]);
  return { book: data.book, source, history, page, historyCount: Number(count[0].n), pageCount: Math.max(1, Math.ceil(Number(count[0].n) / 20)), orders: orders.slice(0, 100), moreOrders: orders.length > 100 };
}
