import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { evaluateProductionGate, type ProductionGate } from "@/server/domain/production-gate";
import { getOrderMaterialSupply } from "@/server/services/order-material-supply";

export type ProductionGateView = ProductionGate & {
  orderId: string;
  orderNo: string;
  updatedAt: string;
};

function sizesAligned(colors: Array<{ quantity: number; sizes: Array<{ quantity: number }> }>) {
  if (colors.length === 0) return false;
  return colors.every((color) => color.sizes.reduce((sum, row) => sum + row.quantity, 0) === color.quantity);
}

export async function getProductionGate(organizationId: string, orderId: string, db: Prisma.TransactionClient = prisma): Promise<ProductionGateView> {
  const order = await db.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: {
      production: true,
      tasks: true,
      lines: { include: { version: true, colors: { include: { sizes: true } } } },
    },
  });
  if (!order) throw new Error("订单不存在或不属于当前组织");

  const colors = order.lines.flatMap((line) => line.colors).filter(c => c.quantity > 0);
  const versions = order.lines.map((line) => line.version).filter((version) => Boolean(version));
  const specApproved = versions.length > 0 && versions.every((version) => version?.status === "approved");
  const specTaskOpen = order.tasks.some((task) => task.kind === "missing_rib_spec" && task.status === "open");
  const incoming = await db.factoryTransfer.findFirst({ where: { organizationId, newOrderId: order.id, status: "executed" } });
  const stage = incoming ? (JSON.parse(incoming.selectionJson)[0]?.stage ?? "unstarted") : "unstarted";
  const continuation = incoming?.receivedAt && stage !== "unstarted" && JSON.parse(incoming.afterJson).receipt?.continuationReady === true ? JSON.parse(incoming.afterJson).receipt?.continuationNote as string | undefined : undefined;
  const started = order.production.some((row) => row.kind === "started" && row.quantity > 0);
  const colorNames = [...new Set(colors.map((color) => color.colorName))];
  const [records, supply] = await Promise.all([
    db.confirmationRecord.findMany({
      where: { orderId: order.id },
      orderBy: [{ colorName: "asc" }, { round: "asc" }],
    }),
    getOrderMaterialSupply(organizationId, {
      id: order.id,
      factoryId: order.factoryId,
      started,
    }, db),
  ]);
  const latestByColor = new Map<string, { status: string }>();
  for (const row of records) latestByColor.set(row.colorName, row);
  const colorsLatestApproved =
    colorNames.length > 0 && colorNames.every((name) => latestByColor.get(name)?.status === "approved");

  const gate = evaluateProductionGate({
    status: order.status,
    productionReadiness: order.productionReadiness,
    sizesAligned: sizesAligned(colors),
    specApproved,
    specTaskOpen,
    hasColors: colors.length > 0,
    colorsLatestApproved,
    canCut: stage !== "unstarted" ? Boolean(continuation) : supply.canCut,
    cutLabel: stage !== "unstarted" ? `接收实物及后续用料核对：${continuation || "尚未完成"}` : supply.label,
    cutBlockers: stage !== "unstarted" ? (continuation ? [] : ["裁片/半成品实物、接续工序及后续用料尚未核对"]) : supply.blockers,
  });

  const handover = await db.factoryTransfer.findFirst({ where: { organizationId, newOrderId: order.id, status: "executed", receivedAt: null } });
  if (handover) {
    gate.ready = false;
    gate.alreadyReleased = false;
    gate.blockers.push("新工厂尚未确认接收转厂任务");
    gate.label = gate.blockers.join(" · ");
  }
  return {
    ...gate,
    orderId: order.id,
    orderNo: order.orderNo,
    updatedAt: order.updatedAt.toISOString(),
  };
}
