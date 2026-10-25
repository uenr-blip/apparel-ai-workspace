import { prisma } from "@/lib/db";
import { labels } from "@/lib/labels";

import { inventoryAvailability } from "@/server/domain/inventory";
import { getLotLedger } from "@/server/services/inventory-query";
import { inventoryScope, internalResourceReader, ResourceRecordError, type InventoryReadActor } from "@/server/services/resource-scope";
export { ResourceRecordError } from "@/server/services/resource-scope";
export { listInventoryLots } from "@/server/services/inventory-query";

export async function getPartyRecord(organizationId: string, partyId: string, actor: InventoryReadActor = internalResourceReader) {
  inventoryScope(organizationId, actor);
  if (actor.role === "factory" && actor.factoryId !== partyId) throw new ResourceRecordError("往来单位不存在");
  const party = await prisma.party.findFirst({
    where: { id: partyId, organizationId },
    include: {
      lots: { include: { material: true }, orderBy: { availableFrom: "desc" } },
      quotes: { include: { material: true }, orderBy: { validFrom: "desc" } },
      orders: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!party) throw new ResourceRecordError("往来单位不存在");

  const emptyStates: string[] = [];
  if (party.lots.length === 0) emptyStates.push("这个地点还没有批次");
  if (party.kind === "supplier" && party.quotes.length === 0) emptyStates.push("还没有报价");
  if (party.kind === "factory" && party.orders.length === 0) emptyStates.push("还没有派给这家工厂的订单");

  return {
    id: party.id,
    code: party.code,
    name: party.name,
    kind: party.kind,
    kindLabel: labels.partyKind(party.kind),
    demoNote: party.demoNote,
    facts: ["往来单位不是客户文件夹", "地点上的料不是领用", "不另开供应商管理菜单"],
    navMenus: [] as string[],
    lots: party.lots.map((lot) => ({
      id: lot.id,
      materialId: lot.materialId,
      materialCode: lot.material.code,
      colorName: lot.colorName,
      qtyOnHand: lot.qtyOnHand,
      qtyAllocated: lot.qtyAllocated,
      qtyInbound: lot.qtyInbound,
      inboundEta: lot.inboundEta,
    })),
    quotes: party.quotes.map((quote) => ({
      id: quote.id,
      materialId: quote.materialId,
      materialCode: quote.material.code,
      unitPriceYuan: (quote.unitPriceMinor / 100).toFixed(2),
      unit: quote.unit,
    })),
    orders: party.orders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      statusLabel: labels.orderStatus(order.status),
    })),
    orderNos: party.orders.map((order) => order.orderNo),
    emptyStates,
  };
}

export async function getLotRecord(organizationId: string, lotId: string, actor: InventoryReadActor = internalResourceReader, movementPage: number | string = 1) {
  const lot = await prisma.inventoryLot.findFirst({
    where: { AND: [inventoryScope(organizationId, actor), { id: lotId }] },
    include: {
      material: true,
      location: true,
      allocations: { where: actor.role === "factory" ? { order: { factoryId: actor.factoryId ?? "" } } : {}, include: { order: true } },
    },
  });
  if (!lot) throw new ResourceRecordError("批次不存在");

  const ledger = await getLotLedger(organizationId, lot.id, movementPage);

  return {
    ...ledger,
    ...inventoryAvailability(lot),
    id: lot.id,
    unit: lot.material.unit,
    locationKind: lot.location.kind,
    materialId: lot.materialId,
    materialCode: lot.material.code,
    materialName: lot.material.name,
    locationId: lot.locationId,
    locationName: lot.location.name,
    locationKindLabel: labels.partyKind(lot.location.kind),
    colorName: lot.colorName,
    qtyOnHand: lot.qtyOnHand,
    qtyAllocated: lot.qtyAllocated,
    qtyInbound: lot.qtyInbound,
    inboundEta: lot.inboundEta,
    inboundNo: lot.inboundNo,
    qualityStatus: lot.qualityStatus,
    ownerKind: lot.ownerKind,
    demoNote: lot.demoNote,
    facts: ["批次不是材料主档", "调拨到工厂不是领用", "在途未收货不是现货"],
    allocations: lot.allocations.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      orderNo: row.order.orderNo,
      qty: row.qty,
      status: row.status,
    })),

  };
}

export async function getQuoteRecord(organizationId: string, quoteId: string, actor: InventoryReadActor = internalResourceReader) {
  inventoryScope(organizationId, actor);
  if (actor.role === "factory") throw new ResourceRecordError("报价不存在");
  const quote = await prisma.supplierQuote.findFirst({
    where: { id: quoteId, organizationId },
    include: { material: true, supplier: true },
  });
  if (!quote) throw new ResourceRecordError("报价不存在");

  const issued = await prisma.purchaseDraft.findFirst({
    where: { organizationId, materialId: quote.materialId, status: "issued" },
  });

  return {
    id: quote.id,
    supplierId: quote.supplierId,
    supplierName: quote.supplier.name,
    materialId: quote.materialId,
    materialCode: quote.material.code,
    materialName: quote.material.name,
    unitPriceYuan: (quote.unitPriceMinor / 100).toFixed(2),
    unit: quote.unit,
    moq: quote.moq,
    multiple: quote.multiple,
    validFrom: quote.validFrom,
    currency: quote.currency,
    demoNote: quote.demoNote,
    issued: Boolean(issued),
    facts: ["历史报价", "不是本项目已确认成本", "不是已采购"],
  };
}
