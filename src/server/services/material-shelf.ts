import { materialImageSrc } from "@/lib/material-image";
import { prisma } from "@/lib/db";
import { labels } from "@/lib/labels";
import { readMaterialCards } from "@/server/services/material-card";

export type MaterialShelfItem = {
  id: string;
  code: string;
  name: string;
  kind: string;
  kindLabel: string;
  specSummary: string;
  unit: string;
  composition: string;
  gsm: string;
  widthCm: string;
  imageSrc: string;
  createdByName: string;
  createdAt: string;
  usedByStyleCodes: string[];
  usedByProjectCodes: string[];
  groupedByCustomer: false;
};

export async function listMaterialShelf(organizationId: string): Promise<MaterialShelfItem[]> {
  const materials = await prisma.material.findMany({
    where: { organizationId, archivedAt: null },
    include: {
      bomLines: { include: { version: { include: { style: true } } } },
      developmentCandidates: { include: { project: true } },
    },
    orderBy: { code: "asc" },
  });
  const cards = await readMaterialCards(materials.map((item) => item.id));
  const creators = await prisma.user.findMany({
    where: { id: { in: [...new Set([...cards.values()].map((card) => card.createdByUserId).filter(Boolean))] } },
    select: { id: true, name: true },
  });
  const creatorName = new Map(creators.map((user) => [user.id, user.name]));

  return materials
    .map((material) => {
      const card = cards.get(material.id);
      const usedByStyleCodes = [
        ...new Set(
          material.bomLines
            .filter((line) => line.version.style.organizationId === organizationId)
            .map((line) => line.version.style.code),
        ),
      ].sort();
      const usedByProjectCodes = [
        ...new Set(
          material.developmentCandidates
            .filter((row) => row.project.organizationId === organizationId)
            .map((row) => row.project.code),
        ),
      ].sort();
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
        createdByName: creatorName.get(card?.createdByUserId ?? "") ?? "",
        createdAt: card?.createdAt ?? "",
        usedByStyleCodes,
        usedByProjectCodes,
        groupedByCustomer: false as const,
      };
    })
    .sort((a, b) => {
      const aUsed = a.usedByStyleCodes.length + a.usedByProjectCodes.length;
      const bUsed = b.usedByStyleCodes.length + b.usedByProjectCodes.length;
      if (Boolean(aUsed) !== Boolean(bUsed)) return aUsed ? -1 : 1;
      return a.code.localeCompare(b.code);
    });
}
