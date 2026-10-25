import { prisma } from "@/lib/db";
import { canSeeFactory } from "@/server/permissions";
import { getOrdersMaterialSupply } from "@/server/services/order-material-supply";
import { inventoryScope, type InventoryReadActor } from "@/server/services/resource-scope";
import {
  todayInboundJobs,
  todayLeftoverJobs,
  todayTransferJobs,
  type TodaySupply,
} from "@/server/domain/today-warehouse";

export async function getTodayWarehouse(organizationId: string, actor: InventoryReadActor) {
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId, ...(actor.role === "factory" ? { factoryId: actor.factoryId ?? "__unassigned_factory__" } : {}) },
    include: { factory: true, production: true },
    orderBy: { orderNo: "asc" },
  });
  const visible = orders.filter((order) => canSeeFactory(actor.role, actor.factoryId, order.factoryId));
  const targets = visible.map((order) => ({
    id: order.id,
    factoryId: order.factoryId,
    started: order.production.some((row) => row.kind === "started" && row.quantity > 0),
  }));
  const supplies = await getOrdersMaterialSupply(organizationId, targets);
  const todaySupplies: TodaySupply[] = visible.map((order) => {
    const supply = supplies.get(order.id);
    const started = targets.find((item) => item.id === order.id)?.started ?? false;
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      factoryName: order.factory?.name ?? "未派厂",
      started,
      leftover:
        supply?.leftover ?? {
          kind: "blocked",
          label: "还不能比较余料",
          recommend: null,
          blockers: [],
        },
      lines: supply?.lines ?? [],
    };
  });

  const inboundLots = await prisma.inventoryLot.findMany({
    where: { AND: [inventoryScope(organizationId, actor), { inboundEta: { not: null } }] },
    include: {
      material: true,
      location: true,
      allocations: { include: { order: { select: { orderNo: true } } } },
    },
    orderBy: [{ inboundEta: "asc" }, { id: "asc" }],
  });

  return {
    facts: ["调拨不是领用", "查到有料不等于适用于本单", "在途不是现货", "正式采购未下达"],
    navMenus: [] as string[],
    transfer: todayTransferJobs(todaySupplies),
    leftover: todayLeftoverJobs(todaySupplies),
    inbound: todayInboundJobs(
      inboundLots.map((lot) => ({
        id: lot.id,
        materialId: lot.materialId,
        materialCode: lot.material.code,
        materialName: lot.material.name,
        colorName: lot.colorName,
        qtyInbound: lot.qtyInbound,
        inboundEta: lot.inboundEta,
        locationName: lot.location.name,
        orderNos: [
          ...new Set(
            lot.allocations
              .filter((row) => row.status === "held" || row.status === "planned")
              .map((row) => row.order.orderNo),
          ),
        ],
      })),
    ),
  };
}
