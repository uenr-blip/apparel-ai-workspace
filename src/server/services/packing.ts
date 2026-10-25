import type { Prisma } from "@prisma/client";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { labels } from "@/lib/labels";
import {
  availableFinishedGoods,
  parseWeightKg,
  summarizePackingPlan,
  weightStatusFor,
  type PackingCartonInput,
  type PackingPlanSummary,
} from "@/server/domain/packing";
import { assertLinesMatchOrder, summarizeProduction } from "@/server/domain/production";
import { canApproveAction, canSeeFactory } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { lockOrderForWrite } from "@/server/services/order-write";

export type PackingPlanView = PackingPlanSummary & {
  id: string;
  orderId: string;
  status: "draft" | "occupied" | "shipped";
  idempotencyKey: string;
  note: string | null;
};

type ActorInput = {
  organizationId: string;
  userId: string;
  role: string;
  factoryId: string | null;
};

function viewOf(plan: {
  id: string;
  orderId: string;
  status: string;
  totalQty: number;
  idempotencyKey: string;
  note: string | null;
  cartons: Array<{
    cartonNo: string;
    netWeight: string | null;
    grossWeight: string | null;
    weightStatus: string;
    lines: Array<{ colorName: string; sizeCode: string; quantity: number }>;
  }>;
}): PackingPlanView {
  const summary = summarizePackingPlan(
    plan.cartons.map((carton) => ({
      cartonNo: carton.cartonNo,
      netWeight: carton.netWeight,
      grossWeight: carton.grossWeight,
      weightStatus: carton.weightStatus as PackingCartonInput["weightStatus"],
      lines: carton.lines,
    })),
  );
  return {
    ...summary,
    id: plan.id,
    orderId: plan.orderId,
    status: plan.status as PackingPlanView["status"],
    idempotencyKey: plan.idempotencyKey,
    note: plan.note,
    total: plan.totalQty,
  };
}

const planInclude = {
  cartons: { include: { lines: true }, orderBy: { cartonNo: "asc" as const } },
};

export async function occupiedFinishedQty(
  orderId: string,
  exceptPlanId?: string,
  client: {
    packingPlan: {
      findMany: (args: {
        where: { orderId: string; status: string; id?: { not: string } };
        select: { totalQty: true };
      }) => Promise<Array<{ totalQty: number }>>;
    };
  } = prisma,
) {
  const plans = await client.packingPlan.findMany({
    where: {
      orderId,
      status: "occupied",
      ...(exceptPlanId ? { id: { not: exceptPlanId } } : {}),
    },
    select: { totalQty: true },
  });
  return plans.reduce((sum, plan) => sum + plan.totalQty, 0);
}

function packingIdentity(plan: PackingPlanSummary) {
  return JSON.stringify(plan.cartons.map(carton => [carton.cartonNo, carton.lines.map(line => [line.colorName, line.sizeCode, line.quantity]).sort()]).sort());
}

async function assertPackingCatalog(tx: Prisma.TransactionClient, orderId: string, summary: PackingPlanSummary) {
  const lines = await tx.orderLine.findMany({ where: { orderId }, include: { colors: { include: { sizes: true } } } });
  if (lines.length !== 1) throw new ExecutionError("多款订单须先明确装箱款式明细，当前不能合并装箱");
  assertLinesMatchOrder(summary.cartons.flatMap(carton => carton.lines), { colors: lines.flatMap(line => line.colors) });
}

async function assertPackingAvailable(tx: Prisma.TransactionClient, orderId: string, total: number, exceptPlanId?: string) {
  const production = await tx.productionQty.groupBy({ by: ["kind"], where: { orderId }, _sum: { quantity: true } });
  const summary = summarizeProduction(production.map(row => ({ kind: row.kind, quantity: row._sum.quantity ?? 0 })));
  const occupied = await occupiedFinishedQty(orderId, exceptPlanId, tx);
  if (total > availableFinishedGoods({ good: summary.good, shipped: summary.shipped, occupied })) {
    throw new ExecutionError("超过可用成品");
  }
}

export async function createPackingDraft(input: ActorInput & {
  orderId: string; cartons: PackingCartonInput[]; idempotencyKey: string; note?: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createPackingDraft)) throw new ExecutionError("无权保存装箱草稿");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new ExecutionError("幂等键不能为空");
  const summary = summarizePackingPlan(input.cartons);
  return prisma.$transaction(async tx => {
    const order = await lockOrderForWrite(tx, input.organizationId, input.orderId);
    if (!canSeeFactory(input.role, input.factoryId, order.factoryId)) throw new ExecutionError("无权保存装箱草稿");
    const existing = await tx.packingPlan.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } }, include: planInclude,
    });
    if (existing) {
      if (existing.orderId !== order.id || packingIdentity(viewOf(existing)) !== packingIdentity(summary)) {
        throw new ExecutionError("幂等键已用于不同订单或装箱明细");
      }
      return { reused: true, plan: viewOf(existing) };
    }
    await assertPackingCatalog(tx, order.id, summary);
    await assertPackingAvailable(tx, order.id, summary.total);
    const plan = await tx.packingPlan.create({
      data: {
        id: createId(), organizationId: input.organizationId, orderId: order.id,
        status: "draft", totalQty: summary.total, idempotencyKey, note: input.note?.trim() || "装箱草稿",
        cartons: { create: summary.cartons.map(carton => ({
          id: createId(), cartonNo: carton.cartonNo, netWeight: carton.netWeight, grossWeight: carton.grossWeight, weightStatus: carton.weightStatus,
          lines: { create: carton.lines.map(line => ({ id: createId(), ...line })) },
        })) },
      }, include: planInclude,
    });
    await writeAudit({
      organizationId: input.organizationId, actorUserId: input.userId, action: "packing.draft.created", entityType: "PackingPlan", entityId: plan.id,
      summary: `${order.orderNo} 装箱草稿 ${summary.total} 件，未算出运`,
      payloadJson: JSON.stringify({ actionType: ACTION_TYPES.createPackingDraft, total: summary.total, idempotencyKey }),
    }, tx);
    return { reused: false, plan: viewOf(plan) };
  });
}

async function packingContext(tx: Prisma.TransactionClient, input: ActorInput & { planId: string }) {
  const reference = await tx.packingPlan.findFirst({ where: { id: input.planId, organizationId: input.organizationId }, select: { orderId: true } });
  if (!reference) throw new ExecutionError("装箱方案不存在");
  const order = await lockOrderForWrite(tx, input.organizationId, reference.orderId);
  if (!canSeeFactory(input.role, input.factoryId, order.factoryId)) throw new ExecutionError("无权操作装箱方案");
  const plan = await tx.packingPlan.findFirstOrThrow({ where: { id: input.planId, organizationId: input.organizationId }, include: planInclude });
  return { order, plan };
}

export async function occupyPackingPlan(input: ActorInput & { planId: string; idempotencyKey: string }) {
  if (!canApproveAction(input.role, ACTION_TYPES.occupyPacking)) throw new ExecutionError("无权确认装箱占用");
  return prisma.$transaction(async tx => {
    const { order, plan } = await packingContext(tx, input);
    if (plan.status === "occupied" || plan.status === "shipped") return { reused: true, plan: viewOf(plan) };
    if (plan.status !== "draft") throw new ExecutionError("装箱方案状态不能占用");
    await assertPackingCatalog(tx, order.id, viewOf(plan));
    await assertPackingAvailable(tx, order.id, plan.totalQty, plan.id);
    const updated = await tx.packingPlan.update({ where: { id: plan.id }, data: { status: "occupied" }, include: planInclude });
    await writeAudit({
      organizationId: input.organizationId, actorUserId: input.userId, action: "packing.occupied", entityType: "PackingPlan", entityId: plan.id,
      summary: `${order.orderNo} 装箱占用 ${plan.totalQty} 件，尚未出运`,
      payloadJson: JSON.stringify({ actionType: ACTION_TYPES.occupyPacking, idempotencyKey: input.idempotencyKey.trim(), total: plan.totalQty }),
    }, tx);
    return { reused: false, plan: viewOf(updated) };
  });
}

export async function shipPackingPlan(input: ActorInput & { planId: string; idempotencyKey: string }) {
  if (!canApproveAction(input.role, ACTION_TYPES.shipPacking)) throw new ExecutionError("无权确认出运");
  return prisma.$transaction(async tx => {
    const { order, plan } = await packingContext(tx, input);
    if (plan.status === "shipped") return { reused: true, plan: viewOf(plan) };
    if (plan.status !== "occupied") throw new ExecutionError("装箱方案未确认，不能算出运");
    await assertPackingCatalog(tx, order.id, viewOf(plan));
    await assertPackingAvailable(tx, order.id, plan.totalQty, plan.id);
    // Business identity is the immutable plan, never a caller-selected request key.
    const shippedKey = `pack-ship:${plan.id}`;
    await tx.productionQty.create({
      data: {
        id: createId(), orderId: order.id, kind: "shipped", quantity: plan.totalQty, idempotencyKey: shippedKey,
        note: `装箱出运 ${plan.totalQty} 件`,
        lines: { create: plan.cartons.flatMap(carton => carton.lines).map(line => ({ id: createId(), colorName: line.colorName, sizeCode: line.sizeCode, quantity: line.quantity })) },
      },
    });
    const updated = await tx.packingPlan.update({ where: { id: plan.id }, data: { status: "shipped" }, include: planInclude });
    await writeAudit({
      organizationId: input.organizationId, actorUserId: input.userId, action: "packing.shipped", entityType: "PackingPlan", entityId: plan.id,
      summary: `${order.orderNo} 确认出运 ${plan.totalQty} 件`,
      payloadJson: JSON.stringify({ actionType: ACTION_TYPES.shipPacking, idempotencyKey: shippedKey, requestKey: input.idempotencyKey.trim(), total: plan.totalQty }),
    }, tx);
    return { reused: false, plan: viewOf(updated) };
  });
}

export async function recordCartonWeight(
  input: ActorInput & {
    cartonId: string;
    netWeight?: string | null;
    grossWeight?: string | null;
    claimed: "estimated" | "measured";
  },
) {
  if (!canApproveAction(input.role, ACTION_TYPES.recordCartonWeight)) {
    throw new ExecutionError("无权录入箱重");
  }
  let netWeight: string | null;
  let grossWeight: string | null;
  try {
    netWeight = parseWeightKg(input.netWeight);
    grossWeight = parseWeightKg(input.grossWeight);
  } catch (error) {
    throw new ExecutionError(error instanceof Error ? error.message : "重量无效");
  }
  if (input.claimed === "measured" && (!netWeight || !grossWeight)) {
    throw new ExecutionError("净重和毛重都录入才能标实测");
  }
  const weightStatus = weightStatusFor({
    netWeight,
    grossWeight,
    claimed: input.claimed,
  });

  const carton = await prisma.packingCarton.findFirst({
    where: { id: input.cartonId, plan: { organizationId: input.organizationId } },
    include: { plan: { include: { order: true } } },
  });
  if (!carton) throw new ExecutionError("箱不存在");
  if (!canSeeFactory(input.role, input.factoryId, carton.plan.order.factoryId)) {
    throw new ExecutionError("无权录入箱重");
  }

  const updated = await prisma.packingCarton.update({
    where: { id: carton.id },
    data: { netWeight, grossWeight, weightStatus },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "packing.carton.weighed",
    entityType: "PackingCarton",
    entityId: carton.id,
    summary: `${carton.plan.order.orderNo} ${carton.cartonNo} ${labels.weightStatus(weightStatus)}`,
    payloadJson: JSON.stringify({
      actionType: ACTION_TYPES.recordCartonWeight,
      netWeight,
      grossWeight,
      weightStatus,
    }),
  });
  return {
    carton: {
      id: updated.id,
      cartonNo: updated.cartonNo,
      netWeight: updated.netWeight,
      grossWeight: updated.grossWeight,
      weightStatus: updated.weightStatus,
    },
  };
}
