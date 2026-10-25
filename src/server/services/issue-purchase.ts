import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { lockOrderForWrite, lockOrganizationForWrite } from "@/server/services/order-write";

export async function issuePurchaseOrder(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  materialId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.issuePurchaseOrder)) throw new ExecutionError("无权下达采购");
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 120) throw new ExecutionError("凭证标识无效");
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    await lockOrderForWrite(tx, input.organizationId, input.orderId);
    const draft = await tx.purchaseDraft.findFirst({
      where: { organizationId: input.organizationId, orderId: input.orderId, materialId: input.materialId },
    });
    if (!draft) throw new ExecutionError("没有采购草稿");
    const prior = await tx.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        action: "purchase.order.issued",
        payloadJson: { contains: `"idempotencyKey":"${key}"` },
      },
    });
    if (prior && prior.entityId !== draft.id) throw new ExecutionError("提交标记已用于另一张采购单");
    if (draft.status === "stale") throw new ExecutionError("采购草稿已过期，请按当前供给重新采用");
    if (draft.status === "issued") return { reused: true, qty: draft.qty, amountYuan: draft.amountYuan, status: draft.status };
    if (draft.status !== "draft") throw new ExecutionError("采购草稿不能下达");
    if (draft.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ExecutionError("采购草稿已变化，请刷新后重试");
    const saved = await tx.purchaseDraft.update({ where: { id: draft.id }, data: { status: "issued" } });
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "purchase.order.issued",
      entityType: "PurchaseDraft",
      entityId: saved.id,
      summary: `方案 ${saved.optionCode} 已下达采购 ${saved.qty} 米 / ${saved.amountYuan} 元，未收料，未付款`,
      payloadJson: JSON.stringify({ actionType: ACTION_TYPES.issuePurchaseOrder, issued: true, idempotencyKey: key, qty: saved.qty, amountYuan: saved.amountYuan }),
    }, tx);
    return { reused: false, qty: saved.qty, amountYuan: saved.amountYuan, status: saved.status };
  });
}
