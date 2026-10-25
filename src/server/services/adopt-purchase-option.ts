import type { Prisma } from "@prisma/client";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { d } from "@/server/domain/procurement";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { releaseOrderMaterialAllocations } from "@/server/services/inventory-alloc";
import { getPurchaseOptions } from "@/server/services/purchase-options";
import { lockOrderForWrite } from "@/server/services/order-write";

export type AdoptPurchaseOptionInput = {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  materialId: string;
  optionCode: "A" | "B";
  expectedSnapshot: string;
};

type LotRow = {
  id: string;
  qtyOnHand: string;
  qtyAllocated: string;
  qtyInbound: string;
  inboundEta: string | null;
};

function takeFromLots(
  lots: LotRow[],
  need: string,
  capacity: (lot: LotRow) => ReturnType<typeof d>,
) {
  const takes: Array<{ lot: LotRow; qty: string }> = [];
  let remaining = d(need);
  for (const lot of lots) {
    if (remaining.lte(0)) break;
    const free = capacity(lot).minus(lot.qtyAllocated);
    if (free.lte(0)) continue;
    const qty = remaining.lt(free) ? remaining : free;
    takes.push({ lot, qty: qty.toFixed(0) });
    remaining = remaining.minus(qty);
  }
  if (remaining.gt(0)) {
    throw new ExecutionError("库存已被其他订单占用，请刷新后重算");
  }
  return takes;
}

async function casAddAllocated(tx: Prisma.TransactionClient, lot: LotRow, addQty: string, capacity: ReturnType<typeof d>) {
  if (d(addQty).lte(0)) return;
  const next = d(lot.qtyAllocated).plus(addQty);
  if (capacity.minus(lot.qtyAllocated).lt(addQty)) {
    throw new ExecutionError("库存已被其他订单占用，请刷新后重算");
  }
  const updated = await tx.inventoryLot.updateMany({
    where: { id: lot.id, qtyAllocated: lot.qtyAllocated },
    data: { qtyAllocated: next.toFixed(0) },
  });
  if (updated.count !== 1) {
    throw new ExecutionError("库存已被其他订单占用，请刷新后重算");
  }
  lot.qtyAllocated = next.toFixed(0);
}

export async function adoptPurchaseOption(input: AdoptPurchaseOptionInput) {
  if (!canApproveAction(input.role, ACTION_TYPES.adoptPurchaseOption)) {
    throw new ExecutionError("无权采用采购方案");
  }
  if (input.optionCode !== "A" && input.optionCode !== "B") {
    throw new ExecutionError("只能采用方案 A 或 B");
  }

  const order = await prisma.salesOrder.findFirst({
    where: { id: input.orderId, organizationId: input.organizationId },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");

  const existing = await prisma.purchaseDraft.findFirst({
    where: { orderId: input.orderId, materialId: input.materialId, organizationId: input.organizationId },
  });
  if (existing && existing.status !== "stale") {
    if (existing.optionCode !== input.optionCode) {
      throw new ExecutionError(`已采用方案 ${existing.optionCode}，不能改成 ${input.optionCode}`);
    }
    return {
      reused: true,
      poIssued: false as const,
      allocatedFree: existing.allocatedFree,
      reservedInbound: existing.reservedInbound,
      purchaseDraft: {
        id: existing.id,
        qty: existing.qty,
        amountYuan: existing.amountYuan,
        status: existing.status,
        issued: false as const,
      },
    };
  }

  const comparison = await getPurchaseOptions(input.organizationId, input.orderId);
  const line = comparison.lines.find((row) => row.materialId === input.materialId);
  if (!line) throw new ExecutionError("没有可比较的已确认面料需求");
  if (!input.expectedSnapshot || input.expectedSnapshot !== line.snapshot) throw new ExecutionError("采购预览已变化，请刷新后重算");
  const option = input.optionCode === "A" ? line.optionA : line.optionB;
  const needFree = option.allocatedFree;
  const needInbound = option.reservedInbound;

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrderForWrite(tx, input.organizationId, input.orderId);
      const latestDraft = await tx.purchaseDraft.findUnique({
        where: { orderId_materialId: { orderId: input.orderId, materialId: input.materialId } },
      });
      if (latestDraft && latestDraft.status !== "stale") throw new ExecutionError("方案已被采用，请刷新后重算");
      if (existing?.status === "stale") {
        await releaseOrderMaterialAllocations(tx, {
          organizationId: input.organizationId,
          orderId: input.orderId,
          materialId: input.materialId,
        });
      }
      const current = await getPurchaseOptions(input.organizationId, input.orderId, tx);
      if (current.lines.find(row => row.materialId === input.materialId)?.snapshot !== input.expectedSnapshot) {
        throw new ExecutionError("需求、报价或库存已变化，请刷新后重算");
      }
      const lots = await tx.inventoryLot.findMany({
        where: {
          organizationId: input.organizationId,
          materialId: input.materialId,
          qualityStatus: "qualified",
          ownerKind: "company",
        },
      });
      const onHand = lots.filter((lot) => !lot.inboundEta && (!comparison.supplyNeedDate || lot.availableFrom <= comparison.supplyNeedDate));
      const inbound = lots.filter((lot) => Boolean(lot.inboundEta) && comparison.supplyNeedDate && lot.inboundEta! <= comparison.supplyNeedDate);
      const freeTakes = takeFromLots(onHand, needFree, (lot) => d(lot.qtyOnHand));
      const inboundTakes = takeFromLots(inbound, needInbound, (lot) => d(lot.qtyInbound));

      for (const take of freeTakes) {
        await casAddAllocated(tx, take.lot, take.qty, d(take.lot.qtyOnHand));
        await tx.inventoryAllocation.create({
          data: {
            id: createId(),
            lotId: take.lot.id,
            orderId: input.orderId,
            qty: take.qty,
            status: "held",
          },
        });
      }
      for (const take of inboundTakes) {
        await casAddAllocated(tx, take.lot, take.qty, d(take.lot.qtyInbound));
        await tx.inventoryAllocation.create({
          data: {
            id: createId(),
            lotId: take.lot.id,
            orderId: input.orderId,
            qty: take.qty,
            status: "planned",
          },
        });
      }

      const draftData = {
        optionCode: input.optionCode,
        qty: option.buy,
        amountYuan: option.amountYuan,
        allocatedFree: needFree,
        reservedInbound: needInbound,
        status: "draft",
      };
      const draft = existing?.status === "stale"
        ? await tx.purchaseDraft.update({
          where: { id: existing.id },
          data: draftData,
        })
        : await tx.purchaseDraft.create({
        data: {
          id: createId(),
          organizationId: input.organizationId,
          orderId: input.orderId,
          materialId: input.materialId,
          idempotencyKey: `${input.orderId}:${input.materialId}`,
          ...draftData,
        },
      });
      await writeAudit({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "purchase.option.adopted",
        entityType: "PurchaseDraft",
        entityId: draft.id,
        summary: `已采用方案 ${input.optionCode}：占用余料 ${needFree} 米，采购草稿 ${option.buy} 米，未下达采购`,
        payloadJson: JSON.stringify({ actionType: ACTION_TYPES.adoptPurchaseOption, issued: false, optionCode: input.optionCode, qty: option.buy, snapshot: input.expectedSnapshot }),
      }, tx);
      return draft;
    });

    return {
      reused: false,
      poIssued: false as const,
      allocatedFree: needFree,
      reservedInbound: needInbound,
      purchaseDraft: {
        id: result.id,
        qty: result.qty,
        amountYuan: result.amountYuan,
        status: result.status,
        issued: false as const,
      },
      message: `已采用方案 ${input.optionCode}：占用余料 ${needFree} 米，采购草稿 ${option.buy} 米，未下达采购`,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const draft = await prisma.purchaseDraft.findUnique({
        where: { orderId_materialId: { orderId: input.orderId, materialId: input.materialId } },
      });
      if (draft && draft.optionCode === input.optionCode) {
        return {
          reused: true,
          poIssued: false as const,
          allocatedFree: draft.allocatedFree,
          reservedInbound: draft.reservedInbound,
          purchaseDraft: {
            id: draft.id,
            qty: draft.qty,
            amountYuan: draft.amountYuan,
            status: draft.status,
            issued: false as const,
          },
        };
      }
    }
    throw error;
  }
}
