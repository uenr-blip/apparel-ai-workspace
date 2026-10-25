import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ROLES } from "@/lib/constants";
import { writeAudit } from "@/server/services/intake";

export class SeasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeasonError";
  }
}

export async function listSeasons(organizationId: string) {
  return prisma.season.findMany({
    where: { organizationId },
    orderBy: { sort: "asc" },
  });
}

export async function linkStyleSeason(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  seasonId: string;
}) {
  if (input.role === ROLES.factory) throw new SeasonError("无权挂接季节");
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new SeasonError("款式不存在或不属于当前组织");
  const season = await prisma.season.findFirst({
    where: { id: input.seasonId, organizationId: input.organizationId },
  });
  if (!season) throw new SeasonError("季节不存在或不属于当前组织");

  const existing = await prisma.styleSeason.findUnique({
    where: { styleId_seasonId: { styleId: style.id, seasonId: season.id } },
  });
  if (existing) return { reused: true, styleId: style.id, seasonCode: season.code };

  await prisma.styleSeason.create({
    data: { id: createId(), styleId: style.id, seasonId: season.id },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style.season.linked",
    entityType: "Style",
    entityId: style.id,
    summary: `款号 ${style.code} 挂上季节 ${season.code}，未复制主档，大货号仍未核实`,
  });
  return { reused: false, styleId: style.id, seasonCode: season.code };
}
