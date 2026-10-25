import type { Prisma } from "@prisma/client";
import { readConstruction } from "@/lib/style-construction";
import { createId } from "@/lib/hash";
import { ExecutionError } from "./execution";
import { parseConsumptionInput } from "./style-bom";
import { writeAudit } from "./intake";
import { PATTERN_FIELDS, fieldValue, readPatternContent, type PatternField } from "@/lib/pattern-workflow";

/** Production takes the explicitly saved stage snapshot, never an unrelated later master draft. */
export async function productionVersionFromStage(db: Prisma.TransactionClient, input: { organizationId: string; userId: string; rowId: string; styleId: string }) {
  const stage = await db.workflowStage.findFirst({ where: { organizationId: input.organizationId, followRowId: input.rowId }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  if (!stage) return null;
  const snapshot = stage.revisions[0];
  if (!snapshot || stage.styleId !== input.styleId) throw new ExecutionError("阶段资料与款式不一致，请核对后开单");
  const rows = readConstruction(snapshot.constructionJson);
  const source = JSON.parse(snapshot.sourceSnapshotJson) as { pattern?: { number: number; craftFamily: string; sheetJson: string } };
  const pattern = source.pattern ? readPatternContent(source.pattern.craftFamily, source.pattern.sheetJson) : null;
  const specs = pattern ? Object.entries(PATTERN_FIELDS).flatMap(([key, label]) => { const value = fieldValue(pattern, key as PatternField); return value ? [`${label}：${value}`] : []; }).join("\n") : "规格及色尺待核对";
  const latest = await db.styleVersion.findFirst({ where: { styleId: input.styleId }, orderBy: { versionNumber: "desc" } });
  const version = await db.styleVersion.create({ data: { id: createId(), styleId: input.styleId, versionNumber: (latest?.versionNumber ?? 0) + 1, status: "draft", cuffType: "待核对", patternRevision: source.pattern ? `版单 V${source.pattern.number} · 阶段资料 ${snapshot.number}` : `阶段资料 ${snapshot.number}`, specNotes: specs, processNotes: rows.filter(r => r.group === "process").map(r => `${r.name}：${JSON.stringify(r.fields)}`).join("\n"), changeSummary: "从本次跟单固定资料开单，等待重新核对和批准", constructionJson: snapshot.constructionJson } });
  for (const row of rows.filter(r => r.group !== "process")) {
    const material = row.materialId ? await db.material.findFirst({ where: { id: row.materialId, organizationId: input.organizationId } }) : null;
    if (!material) throw new ExecutionError("阶段材料引用缺失，请核对后开单");
    await db.bomLine.create({ data: { id: createId(), styleVersionId: version.id, materialId: material.id, consumption: parseConsumptionInput(row.fields.consumption), unit: row.fields.unit || material.unit, confirmed: false, includesAllowance: false, allowanceRate: "0.03", colorScope: "all" } });
  }
  await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: "workflow.production_version_created", entityType: "WorkflowStage", entityId: stage.id, summary: "用本阶段固定资料准备生产资料草稿", payloadJson: JSON.stringify({ before: null, after: { versionId: version.id, status: "draft" }, basis: { rowId: input.rowId, revisionId: snapshot.id }, changes: ["生成生产资料草稿；单耗、资料和分色需重新核对，未批准投产"] }) }, db);
  return version;
}
