import type { Prisma } from "@prisma/client";

export type InventoryReadActor = { role: string; factoryId: string | null };
export const internalResourceReader: InventoryReadActor = { role: "manager", factoryId: null };

export class ResourceRecordError extends Error {
  constructor(message: string) { super(message); this.name = "ResourceRecordError"; }
}

export function inventoryScope(organizationId: string, actor: InventoryReadActor): Prisma.InventoryLotWhereInput {
  if (!["manager", "salesperson", "factory"].includes(actor.role)) throw new ResourceRecordError("无权查阅资源");
  if (actor.role !== "factory") return { organizationId };
  return actor.factoryId ? { organizationId, locationId: actor.factoryId } : { organizationId, id: { in: [] } };
}

export function resourcePage(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 1000) : 1;
}
