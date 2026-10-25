import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { OrderPrepConflictError } from "@/server/services/order-prep";
import { BOM_CONSUMPTION_PENDING } from "@/server/services/style-bom";

function sizesAligned(
  colors: Array<{ quantity: number; sizes: Array<{ quantity: number }> }>,
) {
  if (colors.length === 0) return false;
  return colors.every((color) => color.sizes.reduce((sum, row) => sum + row.quantity, 0) === color.quantity);
}

export async function approveOrderSpec(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  expectedUpdatedAt: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.approveBom)) {
    throw new ExecutionError("当前角色无权批准资料版本");
  }

  const order = await prisma.salesOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
    include: {
      lines: { include: { version: true, colors: { include: { sizes: true } } } },
      tasks: true,
    },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");

  const drafts = order.lines.map((line) => line.version).filter((version) => version?.status === "draft");
  const approvedOnOrder = order.lines.map((line) => line.version).filter((version) => version?.status === "approved");
  if (drafts.length === 0 && approvedOnOrder.length > 0) {
    const version = approvedOnOrder[0]!;
    const ribTask = order.tasks.find((task) => task.kind === "missing_rib_spec");
    return {
      orderId: order.id,
      reused: true,
      versionId: version.id,
      versionNumber: version.versionNumber,
      versionStatus: "approved" as const,
      ribTaskStatus: ribTask?.status ?? "done",
      productionReadiness: order.productionReadiness,
      updatedAt: order.updatedAt.toISOString(),
      message: "资料版本已批准，未覆盖历史已批准版本。请继续核对分色和厂里料况，齐备后由经理手动批准投产。",
    };
  }
  if (drafts.length === 0) throw new ExecutionError("没有可批准的资料草稿");
  if (drafts.some((version) => !version?.specNotes.trim())) {
    throw new ExecutionError("请先记录罗纹规格草稿，不能批准空规格");
  }

  const stamp = order.updatedAt.toISOString();
  if (input.expectedUpdatedAt !== stamp) {
    throw new OrderPrepConflictError();
  }

  const actor = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId },
  });
  const complete = sizesAligned(order.lines.flatMap((line) => line.colors));
  const otherBlocking = order.tasks.some(
    (task) =>
      task.kind !== "missing_rib_spec" &&
      task.kind !== "missing_size_breakdown" &&
      task.kind !== "missing_delivery_year" &&
      task.status === "open" &&
      task.blocking,
  );
  const mutable = order.productionReadiness === "blocked_incomplete_spec" || order.productionReadiness === "blocked_unapproved_spec";
  let nextReadiness = order.productionReadiness;
  if (mutable) {
    if (!complete) nextReadiness = "blocked_incomplete_spec";
    else if (otherBlocking) nextReadiness = order.productionReadiness;
    else nextReadiness = "spec_approved";
  }

  const message = complete
    ? "资料版本已批准，未覆盖历史已批准版本。请继续核对分色和厂里料况，齐备后由经理手动批准投产。"
    : "资料版本已批准，色尺尚未对齐，仍不能投产。";

  return prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    if (!await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("当前账号无权批准资料");
    const latest = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    if (latest.updatedAt.toISOString() !== stamp) throw new OrderPrepConflictError();

    for (const version of drafts) {
      if (!version) continue;
      const freshVersion = await tx.styleVersion.findUniqueOrThrow({ where: { id: version.id } });
      if (JSON.stringify(freshVersion) !== JSON.stringify(version)) throw new OrderPrepConflictError();
      await tx.styleVersion.update({
        where: { id: version.id },
        data: {
          status: "approved",
          approvedAt: new Date(),
          approvedByName: actor?.name ?? "经理",
        },
      });
      await tx.bomLine.updateMany({
        where: { styleVersionId: version.id, consumption: { not: BOM_CONSUMPTION_PENDING } },
        data: { confirmed: true },
      });
    }

    for (const version of drafts) {
      if (version?.sourceDocumentId) await tx.taskItem.updateMany({ where: { organizationId: input.organizationId, kind: "pattern_handoff_review", sourceDocumentId: version.sourceDocumentId, status: "open" }, data: { status: "done", note: "交接草稿已在订单资料流程正式批准，投产仍另核对" } });
    }
    await tx.taskItem.updateMany({
      where: { relatedOrderId: order.id, kind: "missing_rib_spec" },
      data: { status: "done", note: "资料版本已批准，罗纹规格成为本单生产依据草稿的正式版本" },
    });

    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        productionReadiness: nextReadiness,
        notes: message,
      },
    });

    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "style_version.approved",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: message,
        payloadJson: JSON.stringify({
          before: drafts, after: { status: "approved", approvedBy: input.userId },
          versionIds: drafts.map((version) => version?.id),
          versionNumbers: drafts.map((version) => version?.versionNumber),
        }),
      },
    });

    const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    const ribTask = await tx.taskItem.findFirst({
      where: { relatedOrderId: order.id, kind: "missing_rib_spec" },
    });
    const version = drafts[0]!;
    return {
      orderId: order.id,
      reused: false,
      versionId: version.id,
      versionNumber: version.versionNumber,
      versionStatus: "approved" as const,
      ribTaskStatus: ribTask?.status ?? "done",
      productionReadiness: nextReadiness,
      updatedAt: updated.updatedAt.toISOString(),
      message,
    };
  });
}
