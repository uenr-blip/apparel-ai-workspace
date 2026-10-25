import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { quantityText } from "@/lib/material-quantity";
import { evaluateCutSupply, type CutLot, type CutPlanLine, type CutSupplySummary } from "@/server/domain/cut-readiness";
import { leftoverNextStep, type LeftoverNext } from "@/server/domain/leftover-next";
import { aggregateMaterialPlan } from "@/server/services/material-plan";
import { d } from "@/server/domain/procurement";

export type OrderMaterialSupply = CutSupplySummary & {
  orderId: string;
  leftover: LeftoverNext;
  facts: string[];
};

type OrderSupplyTarget = {
  id: string;
  factoryId: string | null;
  started: boolean;
};

function planLinesFromOrder(order: {
  lines: Array<{
    totalQuantity: number;
    version: {
      bomLines: Array<{
        materialId: string;
        consumption: string;
        unit: string;
        includesAllowance: boolean;
        allowanceRate: string;
        confirmed: boolean;
        material: { code: string; name: string };
      }>;
    } | null;
  }>;
}): CutPlanLine[] {
  return aggregateMaterialPlan(
    order.lines.map((line) => ({
      totalQuantity: line.totalQuantity,
      bomLines: line.version?.bomLines ?? [],
    })),
  ).lines;
}

export async function getOrdersMaterialSupply(
  organizationId: string,
  targets: OrderSupplyTarget[],
  db: Prisma.TransactionClient = prisma,
): Promise<Map<string, OrderMaterialSupply>> {
  const result = new Map<string, OrderMaterialSupply>();
  if (!targets.length) return result;

  const orders = await db.salesOrder.findMany({
    where: { organizationId, id: { in: targets.map((item) => item.id) } },
    include: {
      lines: { include: { version: { include: { bomLines: { include: { material: true } } } } } },
    },
  });
  const startedById = new Map(targets.map((item) => [item.id, item]));
  const planByOrder = new Map<string, CutPlanLine[]>();
  const materialIds = new Set<string>();
  for (const order of orders) {
    const lines = planLinesFromOrder(order);
    planByOrder.set(order.id, lines);
    for (const line of lines) materialIds.add(line.materialId);
  }

  const lots = materialIds.size
    ? await db.inventoryLot.findMany({
        where: { organizationId, materialId: { in: [...materialIds] } },
        include: { location: true },
      })
    : [];
  const allocations = lots.length
    ? await db.inventoryAllocation.findMany({
        where: {
          orderId: { in: targets.map((item) => item.id) },
          status: { in: ["held", "planned"] },
          lotId: { in: lots.map((lot) => lot.id) },
        },
      })
    : [];
  const orderIds = targets.map((item) => item.id);
  const useRows = orderIds.length
    ? await db.$queryRaw<Array<{ orderId: string; lotId: string; qtyMilli: bigint }>>(
        Prisma.sql`SELECT orderId, lotId, SUM(qtyMilli) AS qtyMilli
          FROM MaterialUse
          WHERE organizationId = ${organizationId}
            AND orderId IN (${Prisma.join(orderIds)})
          GROUP BY orderId, lotId`,
      )
    : [];
  const drafts = orderIds.length
    ? await db.purchaseDraft.findMany({
        where: { organizationId, orderId: { in: orderIds } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  for (const order of orders) {
    const target = startedById.get(order.id);
    if (!target) continue;
    const plan = planByOrder.get(order.id) ?? [];
    const cutLots: CutLot[] = lots
      .filter((lot) => plan.some((line) => line.materialId === lot.materialId))
      .map((lot) => ({
        materialId: lot.materialId,
        locationId: lot.locationId,
        locationKind: lot.location.kind,
        qtyOnHand: lot.qtyOnHand,
        qtyAllocated: lot.qtyAllocated,
        allocatedToOrder: allocations
          .filter((row) => row.lotId === lot.id && row.orderId === order.id)
          .reduce((sum, row) => sum + Number(row.qty), 0)
          .toFixed(0),
        consumedOnOrder: quantityText(
          useRows
            .filter((row) => row.lotId === lot.id && row.orderId === order.id)
            .reduce((sum, row) => sum + BigInt(row.qtyMilli ?? 0), BigInt(0)),
        ) || "0",
        qualityStatus: lot.qualityStatus,
        ownerKind: lot.ownerKind,
      }));
    const summary = evaluateCutSupply({
      factoryId: target.factoryId,
      started: target.started,
      lines: plan,
      lots: cutLots,
    });
    const facts = [
      "开裁看厂里可用料和已领用，调拨到厂不是领用。",
      "未到料、未调到厂不是完成率。占用只对本单预留有效。",
    ];
    const draft = drafts.find((row) => row.orderId === order.id);
    const leftover = leftoverNextStep({
      started: target.started,
      comparable: summary.lines.some((line) => line.gross !== null),
      freeStock: summary.lines
        .reduce((max, line) => {
          const free = d(line.companyOnHand).minus(line.allocatedToOrder);
          return free.gt(max) ? free : max;
        }, d(0))
        .toFixed(0),
      adopted: draft ? { optionCode: draft.optionCode, status: draft.status } : null,
    });
    if (summary.status === "unknown") facts.unshift(summary.label);
    else if (summary.blockers.length) facts.unshift(`${summary.label}，不能开裁`);
    else facts.unshift(summary.label);
    if (leftover.kind === "ready" || leftover.kind === "stale") facts.unshift(leftover.label);
    result.set(order.id, { ...summary, leftover, orderId: order.id, facts });
  }
  return result;
}

export async function getOrderMaterialSupply(
  organizationId: string,
  order: OrderSupplyTarget,
  db: Prisma.TransactionClient = prisma,
): Promise<OrderMaterialSupply> {
  const map = await getOrdersMaterialSupply(organizationId, [order], db);
  return (
    map.get(order.id) ?? {
      orderId: order.id,
      status: "unknown",
      canCut: false,
      label: "料况未知",
      blockers: [],
      leftover: leftoverNextStep({ started: order.started, comparable: false, freeStock: "0", adopted: null }),
      lines: [],
      facts: ["还没有可判断的面辅料需求"],
    }
  );
}
