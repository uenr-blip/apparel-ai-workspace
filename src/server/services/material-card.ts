import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type MaterialCardFields = {
  imagePath: string;
  composition: string;
  gsm: string;
  widthCm: string;
  createdByUserId: string;
  createdAt: string;
};

const EMPTY_CARD: MaterialCardFields = {
  imagePath: "",
  composition: "",
  gsm: "",
  widthCm: "",
  createdByUserId: "",
  createdAt: "",
};

export function buildSpecSummary(input: { composition: string; gsm: string; widthCm: string; specSummary?: string }) {
  const spec = input.specSummary?.trim();
  if (spec && spec !== "未填写") return spec;
  const parts = [
    input.composition.trim(),
    input.gsm.trim() ? `${input.gsm.trim()}g/m²` : "",
    input.widthCm.trim() ? `${input.widthCm.trim()}cm` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "未填写";
}

export async function writeMaterialCard(
  materialId: string,
  fields: Partial<MaterialCardFields>,
  db: Pick<typeof prisma, "$executeRaw"> = prisma,
) {
  await db.$executeRaw`UPDATE Material
    SET imagePath = COALESCE(${fields.imagePath ?? null}, imagePath),
        composition = COALESCE(${fields.composition ?? null}, composition),
        gsm = COALESCE(${fields.gsm ?? null}, gsm),
        widthCm = COALESCE(${fields.widthCm ?? null}, widthCm),
        createdByUserId = CASE WHEN ${fields.createdByUserId ?? ""} = '' THEN createdByUserId ELSE ${fields.createdByUserId ?? ""} END,
        createdAt = CASE WHEN ${fields.createdAt ?? ""} = '' THEN createdAt ELSE ${fields.createdAt ?? ""} END
    WHERE id = ${materialId}`;
}

export async function readMaterialCards(ids: string[], db: Pick<typeof prisma, "$queryRaw"> = prisma) {
  if (!ids.length) return new Map<string, MaterialCardFields>();
  const listed = await db.$queryRaw<Array<MaterialCardFields & { id: string }>>(
    Prisma.sql`SELECT id,
      COALESCE(imagePath, '') imagePath,
      COALESCE(composition, '') composition,
      COALESCE(gsm, '') gsm,
      COALESCE(widthCm, '') widthCm,
      COALESCE(createdByUserId, '') createdByUserId,
      COALESCE(createdAt, '') createdAt
    FROM Material
    WHERE id IN (${Prisma.join(ids)})`,
  );
  const map = new Map<string, MaterialCardFields>();
  for (const row of listed) {
    map.set(row.id, {
      imagePath: row.imagePath ?? "",
      composition: row.composition ?? "",
      gsm: row.gsm ?? "",
      widthCm: row.widthCm ?? "",
      createdByUserId: row.createdByUserId ?? "",
      createdAt: row.createdAt ?? "",
    });
  }
  return map;
}

export function emptyMaterialCard(): MaterialCardFields {
  return { ...EMPTY_CARD };
}
