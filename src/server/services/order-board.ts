import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { styleImageSrc } from "@/lib/style-image";
import { canApproveAction, canSeeFactory } from "@/server/permissions";
import { classifyOrderWatch, type OrderWatch } from "@/server/domain/order-watch";
import { ExecutionError } from "@/server/services/execution";

export type OrderSummary = {
  id: string;
  orderNo: string;
  customerName: string;
  styleCodes: string;
  imageSrc: string | null;
  colors: string;
  quantity: number;
  po: string;
  factoryName: string;
  delivery: string;
  watch: OrderWatch;
  status: string;
  readiness: string;
  createdByName: string;
  hasPurchaseDraft: boolean;
};

export async function listOrderSummaries(
  organizationId: string,
  actor: { role: string; factoryId: string | null },
): Promise<OrderSummary[]> {
  const orders = await prisma.salesOrder.findMany({
    where: { organizationId, archivedAt: null },
    include: {
      customer: true,
      factory: true,
      lines: { include: { style: true, colors: true } },
      tasks: { where: { status: "open", blocking: true } },
      createdBy: true,
      purchaseDrafts: { select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
  return orders
    .filter((order) => canSeeFactory(actor.role, actor.factoryId, order.factoryId))
    .map((order) => {
      const firstStyle = order.lines[0]?.style;
      return {
        id: order.id,
        orderNo: order.orderNo,
        customerName: order.customer.name,
        styleCodes: order.lines.map((line) => line.style.code).join("、") || "—",
        imageSrc: firstStyle ? styleImageSrc(firstStyle) : null,
        colors: order.lines.flatMap((line) => line.colors.map((color) => color.colorName)).join("、") || "—",
        quantity: order.lines.reduce((sum, line) => sum + line.totalQuantity, 0),
        po: order.externalCustomerPo ?? "空",
        factoryName: order.factory?.name ?? "未指定工厂",
        delivery: order.requestedDeliveryDate ?? order.requestedDeliveryText ?? "未写",
        watch: classifyOrderWatch(order.tasks, order.productionReadiness),
        status: order.status,
        readiness: order.productionReadiness,
        createdByName: order.createdBy?.name ?? "未记",
        hasPurchaseDraft: order.purchaseDrafts.length > 0,
      } satisfies OrderSummary;
    });
}

export async function assignOrderFactory(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  factoryId: string | null;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.assignOrderFactory)) {
    throw new ExecutionError("当前角色无权指派工厂");
  }
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    const user = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true } });
    if (!user || user.role !== input.role) throw new ExecutionError("账号或权限已变化，请重新登录核对");
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, organizationId: input.organizationId },
    });
    if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
    if (order.productionReadiness === "shipped") {
      throw new ExecutionError("已出运订单不能改派工厂");
    }
    let factoryName = "未指定工厂";
    if (input.factoryId) {
      const factory = await tx.party.findFirst({
        where: { id: input.factoryId, organizationId: input.organizationId, kind: "factory", archivedAt: null },
      });
      if (!factory) throw new ExecutionError("工厂不存在或不属于当前组织");
      factoryName = factory.name;
    }
    if (order.factoryId === (input.factoryId || null)) {
      return { orderId: order.id, factoryId: order.factoryId, reused: true as const };
    }
    const [production, purchases, allocations] = await Promise.all([
      tx.productionQty.count({ where: { orderId: order.id } }),
      tx.purchaseDraft.count({ where: { orderId: order.id } }),
      tx.inventoryAllocation.count({ where: { orderId: order.id } }),
    ]);
    if (production || purchases || allocations || order.productionReadiness === "ready_for_production") throw new ExecutionError("本单已有投产、采购或用料记录，请记录转厂并核对影响，由主管确认；不能直接改派工厂覆盖原记录");
    await tx.salesOrder.update({
      where: { id: order.id },
      data: { factoryId: input.factoryId || null },
    });
    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "order.factory_assigned",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `订单 ${order.orderNo} 派给 ${factoryName}，未改款式主档，未投产`,
        payloadJson: JSON.stringify({ before: { factoryId: order.factoryId }, after: { factoryId: input.factoryId || null, factoryName }, basis: "负责人核对首次派厂；尚无采购、用料或生产记录" }),
      },
    });
    return { orderId: order.id, factoryId: input.factoryId || null, reused: false as const };
  });
}
