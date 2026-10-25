import { prisma } from "@/lib/db";
import type { ConstructionMaterialChoice } from "@/lib/style-construction";

/** Same material catalogue for master files, development and follow stages. No stock implied. */
export async function constructionLibrary(organizationId: string): Promise<ConstructionMaterialChoice[]> {
  const rows = await prisma.material.findMany({ where: { organizationId, archivedAt: null }, select: { id: true, code: true, name: true, kind: true, unit: true, composition: true, gsm: true, widthCm: true, specSummary: true, imagePath: true }, orderBy: { code: "asc" } });
  return rows.map(({ imagePath, ...row }) => ({ ...row, hasImage: Boolean(imagePath && !imagePath.startsWith("/") && /\.(png|jpe?g)$/i.test(imagePath)) }));
}
