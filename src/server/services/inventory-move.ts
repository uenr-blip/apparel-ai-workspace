import type { Prisma } from "@prisma/client";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { d } from "@/server/domain/procurement";
import { inventoryAvailability } from "@/server/domain/inventory";
import { canUserAction } from "@/server/services/user-permissions";
import { ExecutionError } from "@/server/services/execution";
import { nonnegativeMilli,reservedForOrder,consumeReservations } from "./material-reservations";
import { quantityMilli } from "@/lib/material-quantity";
import { inheritMaterialOrigin, recordMaterialUse } from "./material-db";
import { writeAudit } from "@/server/services/intake";

type MoveInput = {
  organizationId: string; userId: string; role: string; lotId: string;
  qty: string; idempotencyKey: string; note?: string;
  factoryId?: string | null; orderId?: string;
};
type Movement = Prisma.InventoryMovementGetPayload<Record<string, never>>;

function parseQty(raw: string) {
  quantityMilli(raw);
  return d(raw.trim());
}

export async function companyOwnedOnHand(organizationId: string, materialId: string, client: Pick<Prisma.TransactionClient, "inventoryLot"> = prisma) {
  const lots = await client.inventoryLot.findMany({ where: { organizationId, materialId, ownerKind: "company" }, select: { qtyOnHand: true } });
  return lots.reduce((sum, lot) => sum.plus(lot.qtyOnHand), d(0)).toFixed();
}

async function validateInput(input: MoveInput, kind: "transfer" | "consume") {
  if (!await canUserAction(input, kind === "transfer" ? "inventory_transfer" : "inventory_consume")) throw new ExecutionError(kind === "transfer" ? "无权过账调拨" : "无权过账领用");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 120) throw new ExecutionError("凭证标识无效");
  return { qty: parseQty(input.qty), idempotencyKey };
}

function assertSameMovement(existing: Movement, input: MoveInput & { toLocationId?: string }, kind: string, qty: string) {
  if (kind === "consume" && existing.kind !== "consume") throw new ExecutionError("不能把调拨改成领用");
  if (existing.kind !== kind || existing.fromLotId !== input.lotId || existing.qty !== qty ||
      (existing.toLocationId ?? null) !== (input.toLocationId ?? null)) {
    throw new ExecutionError("同一凭证标识的动作、批次、数量或去向不一致，请核对原凭证");
  }
}

async function receipt(tx: Pick<Prisma.TransactionClient, "inventoryLot">, organizationId: string, movement: Movement, reused: boolean) {
  const fromLot = movement.fromLotId ? await tx.inventoryLot.findFirst({ where: { organizationId, id: movement.fromLotId } }) : null;
  const toLot = movement.toLotId ? await tx.inventoryLot.findFirst({ where: { organizationId, id: movement.toLotId } }) : null;
  return {
    reused, movement, fromLotId: movement.fromLotId, toLotId: movement.toLotId,
    fromOnHand: fromLot?.qtyOnHand ?? "0", toOnHand: toLot?.qtyOnHand ?? "0",
    companyOnHand: await companyOwnedOnHand(organizationId, movement.materialId, tx),
  };
}

async function currentLot(tx: Prisma.TransactionClient, input: MoveInput, qty: ReturnType<typeof d>, kind: "transfer" | "consume") {
  const lot = await tx.inventoryLot.findFirst({ where: { id: input.lotId, organizationId: input.organizationId }, include: { location: true } });
  if (!lot) throw new ExecutionError("批次不存在");
  if (input.role === "factory" && input.factoryId !== lot.locationId) throw new ExecutionError("无权办理其他工厂的批次");
  if (kind === "consume" && lot.location.kind !== "factory") throw new ExecutionError("原料库不能直接领用，请先调拨到工厂");
  const own=input.orderId&&kind==="consume"?await reservedForOrder(tx,lot.id,input.orderId):null;
  const availability = inventoryAvailability(own&&own.qty>BigInt(0)?{...lot,qtyAllocated:d(lot.qtyAllocated).minus(d(own.qty.toString()).div(1000)).toFixed()}:lot);
  if (!availability.canMove) throw new ExecutionError(`这批料不能办理：${availability.unavailableReasons.join("；")}`);
  if (d(availability.availableQty).lt(qty)) throw new ExecutionError(kind === "transfer" ? "可调拨不足，占用中的数量不能调走" : "可领用不足");
  return lot;
}

async function debitLot(tx: Prisma.TransactionClient, lot: Awaited<ReturnType<typeof currentLot>>, qty: ReturnType<typeof d>, orderId?:string) {
  const held=orderId?await reservedForOrder(tx,lot.id,orderId):null;
  const used=held?(quantityMilli(qty.toFixed())<held.qty?quantityMilli(qty.toFixed()):held.qty):BigInt(0);
  if(used>nonnegativeMilli(lot.qtyAllocated))throw new ExecutionError("\u5360\u7528\u8bb0\u5f55\u4e0e\u6279\u6b21\u4e0d\u4e00\u81f4");
  const updated = await tx.inventoryLot.updateMany({
    where: {
      id: lot.id, organizationId: lot.organizationId, qtyOnHand: lot.qtyOnHand, qtyAllocated: lot.qtyAllocated,
      ownerKind: lot.ownerKind, qualityStatus: lot.qualityStatus, inboundEta: lot.inboundEta, availableFrom: lot.availableFrom,
    },
    data: { qtyOnHand: d(lot.qtyOnHand).minus(qty).toFixed(),qtyAllocated:d(lot.qtyAllocated).minus(d(used.toString()).div(1000)).toFixed() },
  });
  if(orderId&&updated.count===1)await consumeReservations(tx,lot.id,orderId,used);
  if (updated.count !== 1) throw new ExecutionError("批次余额已变化，请刷新后重试");
}

async function reuseAfterConflict(input: MoveInput & { toLocationId?: string }, kind: "transfer" | "consume", qty: string, key: string, error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
    const existing = await prisma.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: key } } });
    if (existing) {
      assertSameMovement(existing, input, kind, qty);
      if (kind === "consume" && input.orderId) {
        const [use] = await prisma.$queryRaw<Array<{orderId:string|null}>>`SELECT orderId FROM MaterialUse WHERE organizationId=${input.organizationId} AND movementId=${existing.id}`;
        if (use?.orderId !== input.orderId) throw new ExecutionError("\u540c\u4e00\u51ed\u8bc1\u7684\u8017\u7528\u8ba2\u5355\u4e0d\u4e00\u81f4");
      }
      return receipt(prisma, input.organizationId, existing, true);
    }
  }
  if (error && typeof error === "object" && "code" in error && ["P2034", "P2028"].includes(String(error.code))) {
    throw new ExecutionError("批次正在被其他操作更新，请刷新后重试");
  }
  throw error;
}

export async function transferInventory(input: MoveInput & { toLocationId: string }) {
  const { qty, idempotencyKey } = await validateInput(input, "transfer");
  try {
    return await prisma.$transaction(async tx => {
      if (!await canUserAction(input, "inventory_transfer", tx)) throw new ExecutionError("无权过账调拨");
      const existing = await tx.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } } });
      if (existing) { assertSameMovement(existing, input, "transfer", qty.toFixed()); return receipt(tx, input.organizationId, existing, true); }
      const fromLot = await currentLot(tx, input, qty, "transfer");
      if (fromLot.locationId === input.toLocationId) throw new ExecutionError("调入地点不能和调出地点相同");
      const target = await tx.party.findFirst({ where: { id: input.toLocationId, organizationId: input.organizationId, kind: "factory" } });
      if (!target) throw new ExecutionError("调入工厂不存在");
      await debitLot(tx, fromLot, qty);
      // Preserve provenance: each transfer creates a distinct destination lot.
      const toLot = await tx.inventoryLot.create({ data: {
        id: createId(), organizationId: input.organizationId, materialId: fromLot.materialId,
        locationId: target.id, ownerKind: fromLot.ownerKind, colorName: fromLot.colorName,
        qtyOnHand: qty.toFixed(), qtyAllocated: "0", qtyInbound: "0", qualityStatus: fromLot.qualityStatus,
        availableFrom: fromLot.availableFrom, demoNote: "由调拨凭证生成；来源批次可查，不是领用",
      } });
      await inheritMaterialOrigin(tx, input.organizationId, fromLot.id, toLot.id);
      const movement = await tx.inventoryMovement.create({ data: {
        id: createId(), organizationId: input.organizationId, materialId: fromLot.materialId, kind: "transfer",
        fromLotId: fromLot.id, toLotId: toLot.id, fromLocationId: fromLot.locationId, toLocationId: target.id,
        qty: qty.toFixed(), idempotencyKey, note: input.note?.trim() || "调拨到外协厂，不是领用",
      } });
      await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "inventory.transferred", entityType: "InventoryMovement", entityId: movement.id,
        summary: `调拨 ${qty.toFixed()} 到${target.name}，公司在手合计不变`, payloadJson: JSON.stringify({ actionType: ACTION_TYPES.postInventory, kind: "transfer", qty: qty.toFixed(), idempotencyKey, fromLotId: fromLot.id, toLotId: toLot.id }),
      }, tx);
      return receipt(tx, input.organizationId, movement, false);
    });
  } catch (error) { return reuseAfterConflict(input, "transfer", qty.toFixed(), idempotencyKey, error); }
}

export async function consumeInventory(input: MoveInput) {
  const { qty, idempotencyKey } = await validateInput(input, "consume");
  try {
    return await prisma.$transaction(async tx => {
      if (!await canUserAction(input, "inventory_consume", tx)) throw new ExecutionError("无权过账领用");
      const existing = await tx.inventoryMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey } } });
      if (existing) {
        assertSameMovement(existing, input, "consume", qty.toFixed());
        if (input.orderId) { const [use] = await tx.$queryRaw<Array<{ orderId: string | null }>>`SELECT orderId FROM MaterialUse WHERE organizationId=${input.organizationId} AND movementId=${existing.id}`; if (use?.orderId !== input.orderId) throw new ExecutionError("\u540c\u4e00\u51ed\u8bc1\u7684\u8017\u7528\u8ba2\u5355\u4e0d\u4e00\u81f4"); }
        return receipt(tx, input.organizationId, existing, true); }
      const lot = await currentLot(tx, input, qty, "consume");
      await debitLot(tx, lot, qty,input.orderId);
      const movement = await tx.inventoryMovement.create({ data: {
        id: createId(), organizationId: input.organizationId, materialId: lot.materialId, kind: "consume",
        fromLotId: lot.id, fromLocationId: lot.locationId, qty: qty.toFixed(), idempotencyKey,
        note: input.note?.trim() || "工厂领用，不是调拨",
      } });
      await recordMaterialUse(tx, { ...input, factoryId: input.factoryId ?? null }, movement, input.orderId);
      await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "inventory.consumed", entityType: "InventoryMovement", entityId: movement.id,
        summary: `工厂领用 ${qty.toFixed()}，保留原调拨凭证`, payloadJson: JSON.stringify({ actionType: ACTION_TYPES.postInventory, kind: "consume", qty: qty.toFixed(), idempotencyKey, lotId: lot.id }),
      }, tx);
      return receipt(tx, input.organizationId, movement, false);
    });
  } catch (error) { return reuseAfterConflict(input, "consume", qty.toFixed(), idempotencyKey, error); }
}
