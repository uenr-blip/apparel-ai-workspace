import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TradeError } from "@/lib/trade-money";
import { permissionKey } from "./user-permissions";
import type { TradeActor, TradePermission } from "./trade-contract";
export type TradeDb = Prisma.TransactionClient;

export async function tradePermissions(actor: TradeActor, db: TradeDb = prisma) {
  const user = await db.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, active: true, role: actor.role } });
  if (!user || !["manager", "salesperson"].includes(user.role)) return new Set<string>();
  if (user.role === "manager") return new Set(["trade_view", "trade_prepare", "trade_confirm", "trade_cash", "trade_reconcile", "trade_export"]);
  const policies = await db.organizationPolicy.findMany({ where: { organizationId: actor.organizationId, enabled: true, key: { startsWith: `user-action:${encodeURIComponent(user.id)}:trade_` } }, select: { key: true } });
  return new Set(policies.flatMap(row => row.key === permissionKey(user.id, row.key.split(":").at(-1)!) ? [row.key.split(":").at(-1)!] : []));
}
export async function requireTrade(actor: TradeActor, permission: TradePermission = "trade_view", db: TradeDb = prisma) {
  const grants = await tradePermissions(actor, db);
  if (!grants.has("trade_view") || !grants.has(permission)) throw new TradeError("无权执行这项外贸财务操作，请由经理下发查阅及相应动作权限", 403);
}
export async function tradeOrder(db: TradeDb, actor: TradeActor, id: string) {
  const order = await db.salesOrder.findFirst({ where: { id, organizationId: actor.organizationId }, include: { customer: true } });
  if (!order || order.customer.organizationId !== actor.organizationId) throw new TradeError("订单不存在或不属于当前组织", 404);
  return order;
}
export async function tradeParty(db: TradeDb, org: string, kind: string, id: string) {
  const party = kind === "customer" ? await db.customer.findFirst({ where: { organizationId: org, id } }) : await db.party.findFirst({ where: { organizationId: org, id, kind: { in: ["supplier", "factory"] } } });
  if (!party) throw new TradeError("往来方不存在或不属于当前组织");
  return party;
}
export type ContractRow = { id: string; organizationId: string; orderId: string; currency: string; amountMinor: bigint; tradeMode: string; incoterm: string; terms: string; version: number | bigint; createdBy: string; createdAt: string; updatedAt: string };
export type BillRow = { id: string; organizationId: string; orderId: string | null; projectId: string | null; followRowId: string | null; subjectJson: string | null; expenseDate: string | null; expenseReference: string | null; orderNo: string; direction: "receivable" | "payable"; partyKind: string; partyId: string; partyName: string; title: string; category: string; currency: string; amountMinor: bigint; adjustmentMinor: bigint; allocatedMinor: bigint; totalMinor: bigint; openMinor: bigint; dueDate: string; basis: string; packingPlanId: string | null; sourceKind: string; sourceId: string | null; sourceSnapshot: string | null; status: string; version: bigint | number; createdAt: string; voidReason: string | null };
export type CashRow = { cashKind: string | null; treasuryId: string | null; refundedMinor: bigint; id: string; organizationId: string; direction: "receive" | "pay"; partyKind: string; partyId: string; partyName: string; currency: string; amountMinor: bigint; feeMinor: bigint; allocatedMinor: bigint; availableMinor: bigint; bankAccount: string; bankReference: string; occurredOn: string; basis: string; baseCurrency: string | null; baseAmountMinor: bigint | null; exchangeRate: string | null; rateDate: string | null; rateSource: string | null; status: string; version: number | bigint; createdAt: string; voidReason: string | null };

export function billCte(org: string) {
  return Prisma.sql`WITH adj AS (SELECT billId, SUM(amountMinor) amount FROM TradeAdjustment WHERE organizationId=${org} GROUP BY billId),
    alloc AS (SELECT billId, SUM(billAmountMinor) amount FROM TradeAllocation WHERE organizationId=${org} AND status='active' GROUP BY billId),
    bills AS (SELECT b.*, COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label'),'来源待核对') orderNo, COALESCE(c.name,p.name,'历史往来方') partyName,
      COALESCE(adj.amount,0) adjustmentMinor, COALESCE(alloc.amount,0) allocatedMinor,
      b.amountMinor+COALESCE(adj.amount,0) totalMinor,
      b.amountMinor+COALESCE(adj.amount,0)-COALESCE(alloc.amount,0) openMinor
      FROM TradeBill b LEFT JOIN SalesOrder o ON o.id=b.orderId AND o.organizationId=b.organizationId
      LEFT JOIN Customer c ON b.partyKind='customer' AND c.id=b.partyId AND c.organizationId=b.organizationId
      LEFT JOIN Party p ON b.partyKind='party' AND p.id=b.partyId AND p.organizationId=b.organizationId
      LEFT JOIN adj ON adj.billId=b.id LEFT JOIN alloc ON alloc.billId=b.id WHERE b.organizationId=${org})`;
}
export function cashCte(org: string) {
  return Prisma.sql`WITH alloc AS (SELECT cashId, SUM(cashAmountMinor) amount FROM TradeAllocation WHERE organizationId=${org} AND status='active' GROUP BY cashId),
    refunds AS (SELECT sourceCashId,SUM(amountMinor) amount FROM TreasuryRefund WHERE organizationId=${org} AND status='active' GROUP BY sourceCashId),
    cash AS (SELECT t.*, leg.kind cashKind,leg.ownerId treasuryId,COALESCE(refunds.amount,0) refundedMinor,CASE WHEN t.partyKind='internal' THEN '本公司内部换汇' ELSE COALESCE(c.name,p.name,'历史往来方') END partyName, COALESCE(alloc.amount,0) allocatedMinor,
      CASE WHEN leg.cashId IS NOT NULL THEN 0 ELSE t.amountMinor-COALESCE(alloc.amount,0)-COALESCE(refunds.amount,0) END availableMinor FROM TradeCash t
      LEFT JOIN Customer c ON t.partyKind='customer' AND c.id=t.partyId AND c.organizationId=t.organizationId
      LEFT JOIN Party p ON t.partyKind='party' AND p.id=t.partyId AND p.organizationId=t.organizationId
      LEFT JOIN alloc ON alloc.cashId=t.id LEFT JOIN refunds ON refunds.sourceCashId=t.id LEFT JOIN TreasuryLeg leg ON leg.cashId=t.id AND leg.organizationId=t.organizationId WHERE t.organizationId=${org})`;
}
export async function billRow(db: TradeDb, org: string, id: string) {
  const [row] = await db.$queryRaw<BillRow[]>(Prisma.sql`${billCte(org)} SELECT * FROM bills WHERE id=${id}`);
  if (!row) throw new TradeError("单据不存在或不属于当前组织", 404);
  return row;
}
export async function cashRow(db: TradeDb, org: string, id: string) {
  const [row] = await db.$queryRaw<CashRow[]>(Prisma.sql`${cashCte(org)} SELECT * FROM cash WHERE id=${id}`);
  if (!row) throw new TradeError("流水不存在或不属于当前组织", 404);
  return row;
}
export function requireVersion(actual: number | bigint, expected: number) {
  if (Number(actual) !== expected) throw new TradeError("记录版本已变化，请刷新后重新核对", 409);
}
export async function getContractRow(db: TradeDb, org: string, orderId: string) {
  const rows = await db.$queryRaw<ContractRow[]>(Prisma.sql`SELECT * FROM TradeContract WHERE organizationId=${org} AND orderId=${orderId}`);
  return rows[0] ?? null;
}
export async function orderReceivableTotal(db: TradeDb, org: string, orderId: string) {
  const [row] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`${billCte(org)} SELECT COALESCE(SUM(totalMinor),0) total FROM bills WHERE orderId=${orderId} AND direction='receivable' AND status<>'void'`);
  return row.total;
}
