import { prisma } from "@/lib/db";
import { constructionReferences, type ConstructionReference } from "@/lib/construction-reference";

/** Caller supplies an already-authorized order. Resolve the frozen opening snapshot, not today's stage. */
export async function productionConstructionReferences(organizationId: string, orderId: string): Promise<Record<string, ConstructionReference[]>> {
  const lines = await prisma.orderLine.findMany({ where: { orderId, order: { organizationId } } });
  const rows = await prisma.orderMerchStyle.findMany({ where: { sheet: { organizationId }, productionLine: { orderId, order: { organizationId } } } });
  if (!lines.length) return {};
  const stages = await prisma.workflowStage.findMany({ where: { organizationId, followRowId: { in: rows.map(r => r.id) } } });
  const events = await prisma.auditEvent.findMany({ where: { organizationId, action: "workflow.production_version_created", entityType: "WorkflowStage", OR: [{ entityId: { in: stages.map(s => s.id) } }, ...lines.flatMap(l => l.styleVersionId ? [{ payloadJson: { contains: JSON.stringify({ versionId: l.styleVersionId }).slice(1, -1) } }] : [])] } });
  const result: Record<string, ConstructionReference[]> = {};
  for (const event of events) {
    const payload = JSON.parse(event.payloadJson || "{}") as { basis?: { rowId: string; revisionId: string }; after?: { versionId: string } };
    const basis = payload.basis, row = rows.find(r => r.id === basis?.rowId);
    const recipients = lines.filter(l => l.id === row?.productionLineId || l.styleVersionId === payload.after?.versionId);
    if (!recipients.length || !basis) continue;
    const revision = await prisma.workflowRevision.findFirst({ where: { id: basis.revisionId, stageId: event.entityId, stage: { organizationId } } });
    if (revision) for (const line of recipients) result[line.id] = constructionReferences(revision.sourceSnapshotJson);
  }
  return result;
}

export async function factoryCanReadConstructionReferenceImage(organizationId: string, factoryId: string, src: string) {
  const snapshots = await prisma.$queryRaw<Array<{ sourceSnapshotJson: string }>>`
    SELECT DISTINCT r.sourceSnapshotJson FROM AuditEvent a
    JOIN WorkflowRevision r ON r.id = json_extract(a.payloadJson, '$.basis.revisionId') AND r.stageId = a.entityId
    JOIN WorkflowStage s ON s.id = r.stageId AND s.organizationId = a.organizationId
    JOIN OrderMerchStyle m ON m.id = json_extract(a.payloadJson, '$.basis.rowId')
    JOIN OrderLine l ON l.id = m.productionLineId OR l.styleVersionId = json_extract(a.payloadJson, '$.after.versionId')
    JOIN SalesOrder o ON o.id = l.orderId AND o.organizationId = a.organizationId
    WHERE a.organizationId = ${organizationId} AND o.factoryId = ${factoryId}
      AND a.action = 'workflow.production_version_created' AND a.entityType = 'WorkflowStage'
      AND instr(r.sourceSnapshotJson, ${src}) > 0`;
  return snapshots.some(r => constructionReferences(r.sourceSnapshotJson).some(ref => ref.images.includes(src)));
}
