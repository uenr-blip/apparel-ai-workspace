import type { Prisma } from "@prisma/client";
import { d } from "@/server/domain/procurement";
import { ExecutionError } from "@/server/services/execution";

export async function releaseOrderMaterialAllocations(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; orderId: string; materialId: string },
) {
  const lots = await tx.inventoryLot.findMany({
    where: { organizationId: input.organizationId, materialId: input.materialId },
  });
  const lotIds = lots.map((lot) => lot.id);
  if (!lotIds.length) return;
  const allocations = await tx.inventoryAllocation.findMany({
    where: { orderId: input.orderId, lotId: { in: lotIds } },
  });
  for (const allocation of allocations) {
    const lot = lots.find((row) => row.id === allocation.lotId);
    if (!lot) continue;
    const next = d(lot.qtyAllocated).minus(allocation.qty);
    if (next.isNegative()) {
      throw new ExecutionError("库存占用记录不一致，请刷新后重试");
    }
    await tx.inventoryLot.update({
      where: { id: lot.id },
      data: { qtyAllocated: next.toFixed(0) },
    });
    lot.qtyAllocated = next.toFixed(0);
    await tx.inventoryAllocation.delete({ where: { id: allocation.id } });
  }
}
