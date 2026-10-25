import { materialImageSrc } from "@/lib/material-image";
import { prisma } from "@/lib/db";
import { labels } from "@/lib/labels";
import { companyOwnedOnHand } from "@/server/services/inventory-move";
import { readMaterialCards } from "@/server/services/material-card";

export class MaterialRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialRecordError";
  }
}

export async function getMaterialRecord(organizationId: string, materialId: string) {
  const material = await prisma.material.findFirst({
    where: { id: materialId, organizationId },
    include: {
      quotes: { include: { supplier: true }, orderBy: { validFrom: "desc" } },
      lots: { include: { location: true }, orderBy: { availableFrom: "desc" } },
      bomLines: { include: { version: { include: { style: true } } } },
      developmentCandidates: { include: { project: true } },
    },
  });
  if (!material) throw new MaterialRecordError("材料不存在");
  const card = (await readMaterialCards([material.id])).get(material.id);
  const creator = card?.createdByUserId
    ? await prisma.user.findFirst({ where: { id: card.createdByUserId }, select: { name: true } })
    : null;

  const movements = await prisma.inventoryMovement.findMany({
    where: { organizationId, materialId: material.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const usedByStyleCodes = [
    ...new Set(material.bomLines.map((line) => line.version.style.code)),
  ].sort();
  const usedByProjectCodes = [
    ...new Set(material.developmentCandidates.map((row) => row.project.code)),
  ].sort();

  const emptyStates: string[] = [];
  if (material.lots.length === 0) emptyStates.push("还没有库存批次");
  if (material.quotes.length === 0) emptyStates.push("还没有报价");
  if (usedByStyleCodes.length === 0) emptyStates.push("还没有被款式引用");
  if (usedByProjectCodes.length === 0) emptyStates.push("还没有被开发款式引用");

  return {
    id: material.id,
    code: material.code,
    name: material.name,
    kind: material.kind,
    kindLabel: labels.materialKind(material.kind),
    specSummary: material.specSummary,
    unit: material.unit,
    composition: card?.composition ?? "",
    gsm: card?.gsm ?? "",
    widthCm: card?.widthCm ?? "",
    imageSrc: materialImageSrc({ id: material.id, imagePath: card?.imagePath ?? "" }),
    createdByName: creator?.name ?? "",
    createdAt: card?.createdAt ?? "",
    demoNote: material.demoNote,
    companyOnHand: await companyOwnedOnHand(organizationId, material.id),
    facts: ["主档不是库存", "不是已采购", "不按客户文件夹分"],
    navMenus: [] as string[],
    lots: material.lots.map((lot) => ({
      id: lot.id,
      locationName: lot.location.name,
      locationKindLabel: labels.partyKind(lot.location.kind),
      colorName: lot.colorName,
      qtyOnHand: lot.qtyOnHand,
      qtyAllocated: lot.qtyAllocated,
      qtyInbound: lot.qtyInbound,
      inboundEta: lot.inboundEta,
      qualityStatus: lot.qualityStatus,
    })),
    quotes: material.quotes.map((quote) => ({
      id: quote.id,
      supplierName: quote.supplier.name,
      unitPriceYuan: (quote.unitPriceMinor / 100).toFixed(2),
      unit: quote.unit,
      validFrom: quote.validFrom,
    })),
    usedByStyles: material.bomLines.map((line) => ({
      id: line.id,
      styleId: line.version.styleId,
      styleCode: line.version.style.code,
      versionNumber: line.version.versionNumber,
      consumption: line.consumption,
      confirmed: line.confirmed,
    })),
    usedByStyleCodes,
    usedByProjects: material.developmentCandidates.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectCode: row.project.code,
    })),
    usedByProjectCodes,
    movements: movements.map((row) => ({
      id: row.id,
      kind: row.kind,
      qty: row.qty,
      note: row.note,
    })),
    emptyStates,
  };
}
