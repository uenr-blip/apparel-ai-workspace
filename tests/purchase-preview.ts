import { adoptPurchaseOption as execute, type AdoptPurchaseOptionInput } from "@/server/services/adopt-purchase-option";
import { getPurchaseOptions } from "@/server/services/purchase-options";

// Existing behavior tests still execute the real service, with a real current preview.
export async function adoptPurchaseOption(input: Omit<AdoptPurchaseOptionInput, "expectedSnapshot"> & { expectedSnapshot?: string }) {
  const comparison = await getPurchaseOptions(input.organizationId, input.orderId);
  return execute({
    ...input,
    expectedSnapshot: input.expectedSnapshot ?? comparison.lines.find(line => line.materialId === input.materialId)?.snapshot ?? "",
  });
}
