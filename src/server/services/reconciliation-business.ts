import { Prisma } from "@prisma/client";
import { materialAmount } from "@/lib/material-quantity";
import { TradeError } from "@/lib/trade-money";
import { billCte, cashCte, type TradeDb } from "./trade-db";
import type { ReconRole } from "./reconciliation-rules";
export type BusinessAmount = { role: ReconRole; currency: string; amount: bigint; count: number };
export async function readBusinessAmounts(db: TradeDb, org: string) {
  const [bills, cash, uses, costs, unassigned] = await Promise.all([
    db.$queryRaw<Array<{ direction: string; currency: string; amount: bigint; n: bigint }>>(Prisma.sql`${billCte(org)}
      SELECT direction,currency,SUM(openMinor) amount,COUNT(*) n FROM bills WHERE status='confirmed' GROUP BY direction,currency`),
    db.$queryRaw<Array<{ currency: string; amount: bigint; n: bigint }>>(Prisma.sql`${cashCte(org)}
      SELECT currency,SUM(CASE WHEN direction='receive' THEN amountMinor-feeMinor ELSE -amountMinor-feeMinor END) amount,COUNT(*) n FROM cash WHERE status='recorded' GROUP BY currency`),
    db.$queryRaw<Array<{ currency: string | null; price: bigint | null; qty: bigint }>>`WITH returned AS(
      SELECT useId,SUM(qtyMilli) n FROM MaterialEvent WHERE organizationId=${org} AND status='active' AND kind IN ('return_unused','reverse_use') GROUP BY useId)
      SELECT COALESCE(r.currency,u.currency) currency,COALESCE(r.unitPriceMicros,u.unitPriceMicros) price,SUM(u.qtyMilli-COALESCE(e.n,0)) qty
      FROM MaterialUse u LEFT JOIN MaterialReceipt r ON r.id=u.receiptId AND r.organizationId=u.organizationId LEFT JOIN returned e ON e.useId=u.movementId
      WHERE u.organizationId=${org} AND u.orderId IS NOT NULL
      GROUP BY u.orderId,COALESCE(u.receiptId,u.movementId),COALESCE(r.currency,u.currency),COALESCE(r.unitPriceMicros,u.unitPriceMicros)
      HAVING SUM(u.qtyMilli-COALESCE(e.n,0))>0 LIMIT 5001`,
    db.$queryRaw<Array<{ currency: string; amount: bigint; n: bigint }>>(Prisma.sql`${billCte(org)}
      SELECT b.currency,SUM(b.totalMinor) amount,COUNT(*) n FROM bills b LEFT JOIN OrderCostTag t ON t.billId=b.id AND t.organizationId=b.organizationId AND t.active=1
      WHERE b.direction='payable' AND b.status='confirmed' AND ((b.category='processing' AND b.sourceKind NOT IN ('receipt','purchase')) OR (b.category='other' AND b.sourceKind='manual' AND t.kind IS NOT NULL)) GROUP BY b.currency`),
    db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*) n FROM InventoryMovement m LEFT JOIN MaterialUse u ON u.movementId=m.id AND u.organizationId=m.organizationId
      WHERE m.organizationId=${org} AND m.kind='consume' AND u.orderId IS NULL AND (u.qtyMilli IS NULL OR u.qtyMilli>COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.organizationId=m.organizationId AND e.useId=m.id AND e.status='active' AND e.kind IN ('return_unused','reverse_use')),0))`,
  ]);
  if (uses.length > 5000) throw new TradeError("成本核对超过5000个已归单来源，未返回截断金额");
  const groups = new Map<string, BusinessAmount>();
  const add = (role: ReconRole, currency: string, amount: bigint, count: number) => {
    const key = role + ":" + currency, row = groups.get(key) ?? { role, currency, amount: BigInt(0), count: 0 };
    row.amount += amount; row.count += count; groups.set(key, row);
  };
  for (const b of bills) add(b.direction === "receivable" ? "receivable" : "payable", b.currency, b.amount, Number(b.n));
  for (const c of cash) add("funds", c.currency, c.amount, Number(c.n));
  for (const c of costs) add("cost", c.currency, c.amount, Number(c.n));
  let unvalued = 0;
  for (const u of uses) {
    if (u.price === null || !u.currency) unvalued++; else add("cost", u.currency, materialAmount(u.qty, u.price, u.currency), 1);
  }
  return { rows: [...groups.values()], unvalued, unassigned: Number(unassigned[0].n) };
}
