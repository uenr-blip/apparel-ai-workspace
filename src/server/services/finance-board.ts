import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canUserAction } from "@/server/services/user-permissions";
import { ExecutionError } from "@/server/services/execution";
import { resourcePage } from "@/server/services/resource-scope";
import { centsToYuan, financeCte, type FinanceState } from "./finance-query";
import type { ReconActor } from "./recon";

async function authorize(actor: ReconActor) {
  if (!await canUserAction(actor, "generate_factory_recon")) throw new ExecutionError("无权查阅财务，请由经理授权");
}
export async function getFinanceOverview(actor: ReconActor) {
  await authorize(actor);
  const cte = financeCte(actor.organizationId);
  const [counts, amounts, factories, pending, voucherCount, events] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ state: FinanceState; count: bigint }>>(Prisma.sql`${cte} SELECT state, COUNT(*) count FROM finance GROUP BY state`),
    prisma.$queryRaw<Array<{ drafts: bigint; valid: bigint; cents: string | null }>>(Prisma.sql`${cte} SELECT COUNT(draftId) drafts, COUNT(cents) valid, CAST(SUM(cents) AS TEXT) cents FROM finance`),
    prisma.$queryRaw<Array<{ id: string | null; name: string | null; cents: string; count: bigint }>>(Prisma.sql`${cte} SELECT savedFactoryId id, savedFactoryName name, CAST(SUM(cents) AS TEXT) cents, COUNT(*) count FROM finance WHERE cents IS NOT NULL GROUP BY savedFactoryId, savedFactoryName ORDER BY SUM(cents) DESC, savedFactoryId LIMIT 5`),
    prisma.$queryRaw<Array<{ id: string; orderNo: string; factoryName: string | null; state: FinanceState }>>(Prisma.sql`${cte} SELECT id, orderNo, factoryName, state FROM finance WHERE state <> 'saved' ORDER BY CASE state WHEN 'review' THEN 0 WHEN 'changed' THEN 1 WHEN 'basis' THEN 2 ELSE 3 END, updatedAt DESC, id LIMIT 6`),
    prisma.inventoryMovement.count({ where: { organizationId: actor.organizationId } }),
    prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: { in: ["FactoryReconDraft", "InventoryMovement"] } }, select: { id: true, summary: true, createdAt: true, actor: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 }),
  ]);
  const states: Record<FinanceState, number> = { missing: 0, basis: 0, changed: 0, review: 0, saved: 0 };
  for (const row of counts) states[row.state] = Number(row.count);
  const orderCount = Object.values(states).reduce((sum, n) => sum + n, 0);
  return { states, orderCount, pendingCount: orderCount - states.saved, draftCount: Number(amounts[0].drafts),
    excludedDraftCount: Number(amounts[0].drafts - amounts[0].valid),
    amountYuan: amounts[0].cents === null ? null : centsToYuan(amounts[0].cents),
    factories: factories.map(row => ({ id: row.id, name: row.name ?? "历史工厂未留存", amountYuan: centsToYuan(row.cents), count: Number(row.count),
      // Only the display width uses Number; financial amounts remain integer/string.
      width: factories[0]?.cents && BigInt(factories[0].cents) > BigInt(0) ? Number(BigInt(row.cents) * BigInt(10000) / BigInt(factories[0].cents)) / 100 : 0 })),
    pending, voucherCount, events,
  };
}

export async function listFinanceVouchers(actor: ReconActor, filter: { q?: string; page?: string | number; kind?: string } = {}) {
  await authorize(actor);
  const page = resourcePage(filter.page), q = (filter.q ?? "").trim().slice(0, 100);
  const scope = Prisma.sql`FROM InventoryMovement v
    LEFT JOIN Material m ON m.id = v.materialId AND m.organizationId = v.organizationId
    LEFT JOIN Party f ON f.id = v.fromLocationId AND f.organizationId = v.organizationId
    LEFT JOIN Party t ON t.id = v.toLocationId AND t.organizationId = v.organizationId
    WHERE v.organizationId = ${actor.organizationId}
    ${["transfer", "consume"].includes(filter.kind ?? "") ? Prisma.sql`AND v.kind = ${filter.kind}` : Prisma.empty}
    ${q ? Prisma.sql`AND (instr(lower(COALESCE(m.code,'') || ' ' || COALESCE(m.name,'') || ' ' || COALESCE(v.note,'') || ' ' || COALESCE(f.name,'') || ' ' || COALESCE(t.name,'')),lower(${q})) > 0)` : Prisma.empty}`;
  const [counts, ids] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*) count ${scope}`),
    prisma.$queryRaw<Array<{ id: string; materialCode: string | null; materialName: string | null; unit: string | null; fromName: string | null; toName: string | null }>>(Prisma.sql`SELECT v.id, m.code materialCode, m.name materialName, m.unit, f.name fromName, t.name toName ${scope} ORDER BY v.createdAt DESC, v.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  const selectedIds = ids.map(row => row.id);
  const [records, audits] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { organizationId: actor.organizationId, id: { in: selectedIds } } }),
    prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: "InventoryMovement", entityId: { in: selectedIds } }, select: { entityId: true, actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  const recordsById = new Map(records.map(row => [row.id, row]));
  const total = Number(counts[0].count);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), rows: ids.flatMap(row => {
    const record = recordsById.get(row.id);
    return record ? [{ ...record, ...row, actorName: audits.find(audit => audit.entityId === row.id)?.actor?.name ?? "未留存" }] : [];
  }) };
}
