import { Prisma } from "@prisma/client";
import { sha256 } from "@/lib/hash";
import { TradeError } from "@/lib/trade-money";
import { receiptSnapshot, type ReceiptRow } from "./material-db";
import { getFactoryReconPreviews } from "./recon";
import { billSource } from "./trade-bills";
import { billRow, type TradeDb } from "./trade-db";
import type { TradeActor } from "./trade-contract";

type SourceBill = { id: string; orderId: string; sourceKind: string; sourceId: string | null; sourceSnapshot: string | null };
/** Changed upstream sources are separate from historical GL amounts and adjustments. */
export async function changedBusinessBills(db: TradeDb, actor: TradeActor, orderId?: string, billId?: string) {
  const org = actor.organizationId;
  const bills = await db.$queryRaw<SourceBill[]>(Prisma.sql`SELECT id,orderId,sourceKind,sourceId,sourceSnapshot FROM TradeBill
    WHERE organizationId=${org} AND status<>'void' AND sourceKind IN ('receipt','purchase','recon')
    ${orderId ? Prisma.sql`AND orderId=${orderId}` : Prisma.empty}
    ${billId ? Prisma.sql`AND id=${billId}` : Prisma.empty} LIMIT 5001`);
  if (bills.length > 5000) throw new TradeError("来源核对超过5000张单据，请按订单缩小范围；未返回截断结论");
  const changed = new Map<string, string>();
  for (let offset = 0; offset < bills.length; offset += 400) {
    const chunk = bills.slice(offset, offset + 400), receipts = chunk.filter(b => b.sourceKind === "receipt"), purchases = chunk.filter(b => b.sourceKind === "purchase"), recons = chunk.filter(b => b.sourceKind === "recon");
    if (receipts.length) {
      const rows = await db.$queryRaw<Array<ReceiptRow & { net: bigint }>>(Prisma.sql`SELECT r.*,
        r.qtyMilli-COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.organizationId=r.organizationId AND e.receiptId=r.id AND e.kind='return_supplier' AND e.status='active'),0) net
        FROM MaterialReceipt r WHERE r.organizationId=${org} AND r.id IN (${Prisma.join(receipts.map(b => b.sourceId ?? ""))})`);
      const byId = new Map(rows.map(r => [r.id, r]));
      for (const b of receipts) {
        const r = byId.get(b.sourceId ?? "");
        if (!r || r.status !== "active" || r.orderId !== b.orderId || !r.currency || r.unitPriceMicros === null || receiptSnapshot(r, r.net) !== b.sourceSnapshot)
          changed.set(b.id, "收料、退供或计价依据已变化，请先核对应付差异");
      }
    }
    if (purchases.length) {
      const rows = await db.purchaseDraft.findMany({ where: { organizationId: org, id: { in: purchases.map(b => b.sourceId ?? "") } } });
      const byId = new Map(rows.map(r => [r.id, r]));
      for (const b of purchases) {
        const r = byId.get(b.sourceId ?? "");
        if (!r || r.orderId !== b.orderId || r.status !== "draft" || sha256(JSON.stringify(r)) !== b.sourceSnapshot) changed.set(b.id, "采购草稿已变化或过期，请重新核对应付依据");
      }
    }
    if (recons.length) {
      const rows = await getFactoryReconPreviews(org, [...new Set(recons.map(b => b.orderId))], db);
      for (const b of recons) {
        const r = rows.get(b.orderId);
        if (!r || r.draft?.id !== b.sourceId || r.blockedReason || r.needsUpdate || r.snapshot !== b.sourceSnapshot) changed.set(b.id, "加工出运或计价依据已变化，请先核对加工应付");
      }
    }
  }
  return changed;
}

export async function ensureLedgerBusinessSource(db: TradeDb, actor: TradeActor, type: string, id: string) {
  if (type !== "bill" && type !== "adjustment") return;
  let billId = id;
  if (type === "adjustment") {
    const [a] = await db.$queryRaw<Array<{ billId: string }>>`SELECT billId FROM TradeAdjustment WHERE organizationId=${actor.organizationId} AND id=${id}`;
    if (!a) throw new TradeError("扣补来源不存在", 404);
    billId = a.billId;
  }
  const b = await billRow(db, actor.organizationId, billId);
  if (b.sourceKind === "manual") return;
  const current = await billSource(db, actor, b.orderId, b.sourceKind, b.sourceId ?? "");
  if (current.snapshot !== b.sourceSnapshot) throw new TradeError("业务来源依据已变化，请先核对应付差异再制单或过账", 409);
}
