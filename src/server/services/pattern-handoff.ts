import { constructionPublic, readConstruction } from "@/lib/style-construction";
import { writeConstruction } from "./style-construction";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { PATTERN_FIELDS, fieldValue, readPatternContent, SampleFeedback, type PatternField } from "@/lib/pattern-workflow";
import { authorizePattern, patternContextStamp, PatternError } from "./pattern-workflow";
import { lockOrganizationForWrite } from "./order-write";
import type { TradeActor } from "./trade-contract";
export async function getPatternHandoff(actor: TradeActor, projectId: string) {
  await authorizePattern(actor);
  const project = await prisma.developmentProject.findFirst({ where: { id: projectId, organizationId: actor.organizationId }, include: { style: true, patternSamples: { include: { revision: true }, orderBy: { createdAt: "desc" } }, handoffs: { orderBy: { createdAt: "desc" } } } });
  if (!project) throw new PatternError("开发款式不存在");
  const factories = await prisma.party.findMany({ where: { organizationId: actor.organizationId, id: { in: project.patternSamples.map(s => s.factoryId) } }, select: { id: true, name: true } });
  const versions = await prisma.styleVersion.findMany({ where: { id: { in: project.handoffs.map(h => h.styleVersionId) }, style: { organizationId: actor.organizationId } }, select: { id: true, status: true } });
  return { projectId, projectStamp: project.updatedAt.toISOString(), styleId: project.styleId, styleLabel: project.style ? `${project.style.code} ${project.style.name}` : "尚未关联款式主档", contextStamp: await patternContextStamp(actor.organizationId), samples: project.patternSamples.map(s => ({ id: s.id, label: `${factories.find(f => f.id === s.factoryId)?.name ?? "工厂"} · V${s.revision.number} · 第${s.round}轮`, ownerId: s.ownerId, updatedAt: s.updatedAt.toISOString(), feedback: SampleFeedback.parse(JSON.parse(s.feedbackJson)), handoffId: project.handoffs.find(h => h.sampleId === s.id)?.id ?? null })), records: project.handoffs.map(h => ({ id: h.id, styleVersionId: h.styleVersionId, status: versions.find(v => v.id === h.styleVersionId)?.status ?? "待核对", createdAt: h.createdAt.toISOString(), sampleId: h.sampleId, snapshot: JSON.parse(h.snapshotJson) as { versionNumber: number; factoryName: string; revisionNumber: number; round: number; createdByName: string } })) };
}
export async function handoffPatternSample(actor: TradeActor, input: { projectId: string; sampleId: string; projectStamp: string; sampleStamp: string; contextStamp: string; processNotes: string; confirmed: boolean }) {
  if (!input.confirmed) throw new PatternError("请先核对选定工厂、版次和回样结论");
  if (input.processNotes.length > 8000) throw new PatternError("补充交接说明过长");
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, actor.organizationId); const user = await authorizePattern(actor, db);
    const project = await db.developmentProject.findFirst({ where: { id: input.projectId, organizationId: actor.organizationId }, include: { style: { include: { versions: { orderBy: { versionNumber: "desc" } } } } } });
    if (!project?.style) throw new PatternError("请先关联同公司的款式主档，再交接正式资料草稿");
    const sample = await db.patternSample.findFirst({ where: { id: input.sampleId, projectId: project.id }, include: { revision: true } });
    if (!sample || sample.ownerId !== user.id) throw new PatternError("请由这次打样的实际负责人核对交接；需要交接负责人时先在打样记录中变更并留痕");
    const prior = await db.patternHandoff.findUnique({ where: { projectId_sampleId: { projectId: project.id, sampleId: sample.id } } });
    if (prior) {
      const saved = JSON.parse(prior.snapshotJson);
      if (saved.processNotes !== input.processNotes.trim()) throw new PatternError("此回样已交接过，不能用重复提交覆盖原稿；请进入资料草稿修订，或新建打样轮次");
      return { id: prior.id, styleId: project.styleId!, versionId: prior.styleVersionId, reused: true };
    }
    if (project.updatedAt.toISOString() !== input.projectStamp || sample.updatedAt.toISOString() !== input.sampleStamp || await patternContextStamp(actor.organizationId, db) !== input.contextStamp) throw new PatternError("版单、回样或规则已变化，请刷新后重新核对");
    const feedback = SampleFeedback.parse(JSON.parse(sample.feedbackJson));
    if (!sample.issuedAt || !sample.receivedAt || !feedback.returnedOn || feedback.review !== "acceptable") throw new PatternError("请先完成发厂、工厂接收、实际回样和可接受评价，再准备正式资料草稿");
    const factory = await db.party.findFirstOrThrow({ where: { id: sample.factoryId, organizationId: actor.organizationId, kind: "factory" } });
    const content = readPatternContent(sample.revision.craftFamily, sample.revision.sheetJson);
    const specNotes = Object.entries(PATTERN_FIELDS).flatMap(([key, name]) => { const value = fieldValue(content, key as PatternField); return value ? [`${name}：${value}`] : []; }).join("\n");
    if (!specNotes.trim()) throw new PatternError("所选版次没有可交接规格，请先补齐并形成新版本");
    const source = await db.sourceDocument.create({ data: { id: createId(), organizationId: actor.organizationId, contentHash: sha256(`pattern-handoff:${sample.id}:${sample.updatedAt.toISOString()}`), origin: "pattern-handoff", mimeType: "application/json", rawText: JSON.stringify({ projectId: project.id, sample, content, processNotes: input.processNotes.trim(), note: "负责人选定的打样依据，不是资料批准或投产授权" }), receivedAt: new Date(), parseStatus: "succeeded" } });
    const versionNumber = (project.style.versions[0]?.versionNumber ?? 0) + 1;
    const version = await db.styleVersion.create({ data: { id: createId(), styleId: project.style.id, versionNumber, status: "draft", cuffType: "待核对", changeSummary: `来自 ${project.code} · ${factory.name} · V${sample.revision.number} · 第${sample.round}轮可接受回样；未批准`, specNotes, processNotes: input.processNotes.trim(), patternRevision: `${project.code} V${sample.revision.number}`, sourceDocumentId: source.id } });
    const stageMaterials = sample.revision.stageRevisionId ? await db.workflowRevision.findFirst({ where: { id: sample.revision.stageRevisionId, stage: { projectId: project.id, organizationId: actor.organizationId } } }) : null;
    if (stageMaterials) {
      const rows = readConstruction(stageMaterials.constructionJson);
      await writeConstruction(db, { organizationId: actor.organizationId, userId: actor.userId, versionId: version.id, rows: constructionPublic(rows), previous: rows, writtenFiles: [] });
    }
    const snapshot = { stageRevisionId: stageMaterials?.id ?? null, projectId: project.id, styleId: project.style.id, sampleId: sample.id, factoryId: factory.id, factoryName: factory.name, revisionId: sample.revisionId, revisionNumber: sample.revision.number, round: sample.round, content, feedback, versionNumber, processNotes: input.processNotes.trim(), createdByName: user.name, sampleUpdatedAt: input.sampleStamp, contextStamp: input.contextStamp };
    const handoff = await db.patternHandoff.create({ data: { id: createId(), organizationId: actor.organizationId, projectId: project.id, sampleId: sample.id, revisionId: sample.revisionId, styleVersionId: version.id, snapshotJson: JSON.stringify(snapshot), createdBy: user.id } });
    await db.taskItem.create({ data: { id: createId(), organizationId: actor.organizationId, title: "回样已交接：核对正式资料草稿及面辅料单耗", kind: "pattern_handoff_review", status: "open", blocking: true, assigneeRole: "salesperson", relatedStyleId: project.style.id, sourceDocumentId: source.id, note: `已建资料 V${versionNumber}，来自 ${factory.name} V${sample.revision.number} 第${sample.round}轮。材料只在确认后录入；资料批准、分色、投产仍走原流程。` } });
    await db.auditEvent.create({ data: { id: createId(), organizationId: actor.organizationId, actorType: "user", actorUserId: user.id, entityType: "StyleVersion", entityId: version.id, action: "pattern.handoff_created", summary: `选定回样交接到 ${project.style.code} 资料 V${versionNumber} 草稿`, payloadJson: JSON.stringify({ before: { latestVersion: project.style.versions[0]?.id ?? null }, after: { ...snapshot, versionId: version.id, handoffId: handoff.id }, basis: { sourceDocumentId: source.id, sampleId: sample.id, revisionId: sample.revisionId }, note: "旧版本不变，BOM待人核对，不自动批准或指派生产工厂" }) } });
    return { id: handoff.id, styleId: project.style.id, versionId: version.id, reused: false };
  });
}
