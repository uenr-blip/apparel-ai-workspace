import type { Prisma } from "@prisma/client";
import { ExecutionError } from "@/server/services/execution";

/** Acquire SQLite's writer lock before reading organization-scoped idempotency keys or allocating numbers. */
export async function lockOrganizationForWrite(tx: Prisma.TransactionClient, organizationId: string) {
  const changed = await tx.$executeRaw`UPDATE "Organization" SET "name" = "name" WHERE "id" = ${organizationId}`;
  if (changed !== 1) throw new ExecutionError("组织不存在");
}

/** Serialize this order's quantity decisions before reading its mutable ledger. */
export async function lockOrderForWrite(tx: Prisma.TransactionClient, organizationId: string, orderId: string) {
  const order = await tx.salesOrder.findFirst({ where: { id: orderId, organizationId } });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
  const updatedAt = new Date(Math.max(Date.now(), order.updatedAt.getTime() + 1));
  const changed = await tx.salesOrder.updateMany({
    where: { id: order.id, organizationId, updatedAt: order.updatedAt },
    data: { updatedAt },
  });
  if (changed.count !== 1) throw new ExecutionError("订单已变化，请刷新后重试");
  return { ...order, updatedAt };
}
