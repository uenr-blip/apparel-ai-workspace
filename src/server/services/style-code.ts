import type { Prisma } from "@prisma/client";
export async function resolveStyleCodes(db: Prisma.TransactionClient, organizationId: string, codes: string[]) {
  const aliases = await db.styleCodeAlias.findMany({ where: { organizationId, code: { in: codes } } });
  const rows = await db.style.findMany({ where: { organizationId, OR: [{ code: { in: codes } }, { id: { in: aliases.map(a => a.styleId) } }] } });
  const map = new Map(rows.map(r => [r.code, r]));
  for (const a of aliases) { const r = rows.find(r => r.id === a.styleId); if (r) map.set(a.code, r); }
  return map;
}
