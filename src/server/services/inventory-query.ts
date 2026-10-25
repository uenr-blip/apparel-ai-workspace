import { quantityText } from "@/lib/material-quantity";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { inventoryAvailability, inventoryDate } from "@/server/domain/inventory";
import { inventoryScope, resourcePage, type InventoryReadActor } from "@/server/services/resource-scope";

export const INVENTORY_PAGE_SIZE = 20;
export type InventoryFilter = { q?: string; locationId?: string; materialId?: string; state?: string; page?: number | string };

export async function listInventoryLots(organizationId: string, actor: InventoryReadActor, filter: InventoryFilter) {
  const q = (filter.q ?? "").trim().slice(0, 120);
  const page = resourcePage(filter.page);
  const conditions: Prisma.InventoryLotWhereInput[] = [inventoryScope(organizationId, actor)];
  if (filter.locationId) conditions.push({ locationId: filter.locationId });
  if (filter.materialId) conditions.push({ materialId: filter.materialId });
  if (filter.state === "on_hand") conditions.push({ inboundEta: null });
  if (filter.state === "inbound") conditions.push({ inboundEta: { not: null } });
  if (filter.state === "hold") conditions.push({ OR: [{ qualityStatus: { not: "qualified" } }, { ownerKind: { not: "company" } }, { availableFrom: { gt: inventoryDate() } }] });
  for (const word of q.split(/\s+/).filter(Boolean).slice(0, 6)) conditions.push({ OR: [
    { colorName: { contains: word } }, { material: { code: { contains: word } } },
    { material: { name: { contains: word } } }, { material: { specSummary: { contains: word } } },
    { location: { name: { contains: word } } }, { location: { code: { contains: word } } },
  ] });
  const where = { AND: conditions };
  const [total, lots] = await prisma.$transaction([
    prisma.inventoryLot.count({ where }),
    prisma.inventoryLot.findMany({ where, include: { material: true, location: true }, orderBy: [{ availableFrom: "desc" }, { id: "asc" }], skip: (page - 1) * INVENTORY_PAGE_SIZE, take: INVENTORY_PAGE_SIZE }),
  ]);
  return {
    total, page, pageSize: INVENTORY_PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE)),
    rows: lots.map(lot => ({
      id: lot.id, materialId: lot.materialId, materialCode: lot.material.code, materialName: lot.material.name,
      specSummary: lot.material.specSummary, unit: lot.material.unit, colorName: lot.colorName,
      locationId: lot.locationId, locationName: lot.location.name, locationKind: lot.location.kind,
      qtyOnHand: lot.qtyOnHand, qtyAllocated: lot.qtyAllocated, qtyInbound: lot.qtyInbound,
      qualityStatus: lot.qualityStatus, inboundEta: lot.inboundEta, ownerKind: lot.ownerKind,
      ...inventoryAvailability(lot),
    })),
  };
}

// Caller must authorize this lot. Aggregate fixed quantities in thousandths.
export async function getLotLedger(organizationId: string, lotId: string, pageInput: number | string) {
  const page = resourcePage(pageInput);
  const where = { organizationId, OR: [{ fromLotId: lotId }, { toLotId: lotId }] };
  const [total, movements, consumed] = await prisma.$transaction([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: INVENTORY_PAGE_SIZE, skip: (page - 1) * INVENTORY_PAGE_SIZE }),
    prisma.$queryRaw<Array<{ total: string; invalid: bigint }>>(Prisma.sql`
      SELECT CAST(COALESCE(SUM(milli),0) AS TEXT) total, COALESCE(SUM(CASE WHEN milli IS NULL THEN 1 ELSE 0 END),0) invalid
      FROM (SELECT CASE WHEN (qty<>'' AND qty NOT GLOB '*[^0-9]*' AND length(qty)<=10)
        OR (qty NOT GLOB '*[^0-9.]*' AND instr(qty,'.') BETWEEN 2 AND 11 AND length(qty)-instr(qty,'.') BETWEEN 1 AND 3 AND length(qty)-length(replace(qty,'.',''))=1)
        THEN CAST(substr(qty||'.',1,instr(qty||'.','.')-1) AS INTEGER)*1000
          + CASE WHEN instr(qty,'.')=0 THEN 0 ELSE CAST(substr(substr(qty,instr(qty,'.')+1)||'000',1,3) AS INTEGER) END
        ELSE NULL END milli FROM "InventoryMovement" WHERE "organizationId"=${organizationId} AND "fromLotId"=${lotId} AND "kind"='consume')

    `),
  ]);
  const ids = movements.map(row => row.id);
  const locationIds = [...new Set(movements.flatMap(row => [row.fromLocationId, row.toLocationId]).filter((id): id is string => Boolean(id)))];
  const [audits, locations] = await Promise.all([
    prisma.auditEvent.findMany({ where: { organizationId, entityType: "InventoryMovement", entityId: { in: ids } }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.party.findMany({ where: { organizationId, id: { in: locationIds } }, select: { id: true, name: true } }),
  ]);
  const names = new Map(locations.map(row => [row.id, row.name]));
  const actors = new Map(audits.map(row => [row.entityId, row.actor?.name ?? "未留存"]));
  return {
    movementPage: page, movementTotal: total, movementPageCount: Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE)),
    recordedConsumedQty: Number(consumed[0]?.invalid ?? 0) ? null : quantityText(BigInt(consumed[0]?.total ?? "0")),
    movements: movements.map(row => ({
      id: row.id, kind: row.kind, qty: row.qty, note: row.note, createdAt: row.createdAt,
      fromLotId: row.fromLotId, toLotId: row.toLotId,
      fromLocationName: row.fromLocationId ? names.get(row.fromLocationId) ?? "历史地点未留存" : "—",
      toLocationName: row.toLocationId ? names.get(row.toLocationId) ?? "历史地点未留存" : "—",
      actorName: actors.get(row.id) ?? "未留存",
    })),
  };
}
