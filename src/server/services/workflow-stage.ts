import { constructionLibrary } from "./construction-library";
import { constructionReferences } from "@/lib/construction-reference";
import { readPatternContent } from "@/lib/pattern-workflow";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { CONSTRUCTION_FIELDS, constructionPublic, readConstruction } from "@/lib/style-construction";
import { StageTarget, StageTransfer, StageMaterialSource, patternEdition, STAGE_LABELS, type StageTargetInput } from "@/lib/workflow-stage";
import type { TradeActor } from "./trade-contract";
import { ExecutionError } from "./execution";
import { lockOrganizationForWrite } from "./order-write";
import { writeAudit } from "./intake";
import { constructionRows, writeConstruction, type ConstructionUpload } from "./style-construction";
import { readPrivateFile, deletePrivateFile } from "@/server/storage/local";
import { createFollowSheet } from "./order-merch";
import { readSalesSample, readBulk } from "@/server/domain/merch-sheet";
import { resolveStyleCodes } from "./style-code";
import { PLATFORM_CONTEXT_VERSION } from "@/server/context/platform";

type Db = Prisma.TransactionClient;
const freshTime = (old: Date) => new Date(Math.max(Date.now(), old.getTime() + 1));
export async function authorizeStage(actor: TradeActor, db: Db = prisma) {
  if (!["manager", "salesperson"].includes(actor.role) || !await db.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, role: actor.role, active: true } })) throw new ExecutionError("当前账号无权处理阶段交接");
}
async function load(actor: TradeActor, target: StageTargetInput, db: Db = prisma) {
  await authorizeStage(actor, db);
  const project = "projectId" in target ? await db.developmentProject.findFirst({ where: { id: target.projectId, organizationId: actor.organizationId }, include: { style: true } }) : null;
  const row = "followRowId" in target ? await db.orderMerchStyle.findFirst({ where: { id: target.followRowId, sheet: { organizationId: actor.organizationId } }, include: { sheet: true, productionLine: { include: { order: true } } } }) : null;
  if (!project && !row) throw new ExecutionError("业务记录不存在或无权读取");
  if (row && !["sales_sample", "bulk"].includes(row.sheet.kind)) throw new ExecutionError("请选择销售样或大货跟单");
  const style = project?.style ?? (row ? (await resolveStyleCodes(db, actor.organizationId, [row.styleCode])).get(row.styleCode) : null);
  const stage = await db.workflowStage.findFirst({ where: { organizationId: actor.organizationId, ...target }, include: { revisions: { orderBy: { number: "desc" } } } });
  if (stage?.styleId && stage.styleId !== style?.id) throw new ExecutionError("款式关联已变化，请核对交接来源");
  const version = !stage && style ? await db.styleVersion.findFirst({ where: { styleId: style.id }, orderBy: { versionNumber: "desc" }, include: { bomLines: { include: { material: true } }, attachments: true } }) : null;
  const rows = stage ? readConstruction(stage.revisions[0]?.constructionJson) : constructionRows(version);
  const seedReferences = version?.processNotes ? [{ label: "主档原工艺说明", text: version.processNotes, images: [] as string[] }] : [];
  const rules = await db.organizationPolicy.findMany({ where: { organizationId: actor.organizationId, key: { in: ["context:active:company", "context:active:development", "context:active:follow"] } }, orderBy: { key: "asc" }, select: { key: true, valueJson: true } });
  const stamp = sha256(JSON.stringify({ target, project, row, style, stage, version, platform: PLATFORM_CONTEXT_VERSION, rules }));
  return { project, row, style, stage, rows, stamp, seedReferences, seedImageBaseUrl: version ? `/api/styles/${style!.id}/construction/${version.id}` : undefined, kind: project ? "development" : row!.sheet.kind, locked: Boolean(project?.archivedAt || row?.sheet.archivedAt || row?.productionLineId || style?.archivedAt) };
}
export async function getStageWorkspace(actor: TradeActor, rawTarget: unknown) {
  const target = StageTarget.parse(rawTarget), data = await load(actor, target);
  const reads = data.stage ? await prisma.workflowRead.findMany({ where: { organizationId: actor.organizationId, userId: actor.userId } }) : [];
  const [owners, customers, factories, materials, patterns, transfers, recent, unreadEvents] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: actor.organizationId, active: true, role: { in: ["manager", "salesperson"] } }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { organizationId: actor.organizationId, archivedAt: null }, select: { id: true, name: true } }),
    prisma.party.findMany({ where: { organizationId: actor.organizationId, kind: "factory", archivedAt: null }, select: { id: true, name: true } }),
    constructionLibrary(actor.organizationId),
    data.project ? prisma.patternRevision.findMany({ where: { projectId: data.project.id }, orderBy: { number: "desc" }, select: { id: true, number: true, reason: true, stageRevisionId: true } }) : [],
    data.stage ? getStageTransferHistory(actor, data.stage.id) : [],
    data.stage ? prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: "WorkflowStage", entityId: data.stage.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, include: { actor: { select: { name: true } } } }) : [],
    data.stage ? prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: "WorkflowStage", entityId: data.stage.id, actorUserId: { not: actor.userId }, id: { notIn: reads.map(r => r.auditId) } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, include: { actor: { select: { name: true } } } }) : [],
  ]);
  return {
    target, stamp: data.stamp, stageId: data.stage?.id ?? null, kind: data.kind, locked: data.locked,
    canTransfer: Boolean(data.stage?.revisions[0] && data.style && !data.style.archivedAt && !data.project?.archivedAt && !data.row?.sheet.archivedAt && data.kind !== "bulk"),
    label: data.project ? `${data.project.code} ${data.project.name}` : `${data.row!.styleCode} ${data.row!.styleName}`,
    styleId: data.style?.id ?? null, ownerId: data.stage?.ownerId ?? actor.userId,
    customerId: data.row?.sheet.customerId ?? data.project?.customerId ?? "", seasonCode: data.row?.sheet.seasonCode ?? "",
    rows: constructionPublic(data.rows), seedReferences: data.seedReferences, revisionId: data.stage?.revisions[0]?.id ?? null, seedImageBaseUrl: data.seedImageBaseUrl,
    initialNotice: !data.stage && data.rows.length ? "以下为款式资料的参考内容，保存后才成为本阶段的独立版本。请先核对。" : "",
    owners, customers, factories, materials, patterns: patterns.map(p => ({ ...p, label: patternEdition(p.number) })),
    sources: await listMaterialSources(actor, data),
    history: (data.stage?.revisions ?? []).map(r => ({ id: r.id, number: r.number, reason: r.reason, createdAt: r.createdAt.toISOString(), createdBy: owners.find(u => u.id === r.createdBy)?.name ?? "历史用户", rows: constructionPublic(readConstruction(r.constructionJson)), references: constructionReferences(r.sourceSnapshotJson) })),
    transfers,
    events: [...unreadEvents, ...recent.filter(e => !unreadEvents.some(u => u.id === e.id))].map(e => ({ id: e.id, summary: e.summary, actor: e.actor?.name ?? "历史用户", createdAt: e.createdAt.toISOString(), unread: e.actorUserId !== actor.userId && !reads.some(r => r.auditId === e.id), detail: { changes: (JSON.parse(e.payloadJson || "{}") as { changes?: string[] }).changes ?? [] } })),
    order: data.row?.productionLine ? { id: data.row.productionLine.order.id, orderNo: data.row.productionLine.order.orderNo } : null,
  };
}
export type StageWorkspace = Awaited<ReturnType<typeof getStageWorkspace>>;

// Both the page and the assistant use these real, direction-aware handoff links.
export async function getStageTransferHistory(actor: TradeActor, stageId: string) {
  await authorizeStage(actor);
  if (!await prisma.workflowStage.findFirst({ where: { id: stageId, organizationId: actor.organizationId } })) throw new ExecutionError("阶段不存在或无权读取");
  const transfers = await prisma.workflowTransfer.findMany({ where: { organizationId: actor.organizationId, OR: [{ sourceStageId: stageId }, { targetStageId: stageId }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const stages = await prisma.workflowStage.findMany({ where: { organizationId: actor.organizationId, id: { in: transfers.flatMap(t => [t.sourceStageId, t.targetStageId]) } } });
  const [projects, rows, revisions, patterns, users] = await Promise.all([
    prisma.developmentProject.findMany({ where: { organizationId: actor.organizationId, id: { in: stages.flatMap(s => s.projectId ? [s.projectId] : []) } }, select: { id: true } }),
    prisma.orderMerchStyle.findMany({ where: { sheet: { organizationId: actor.organizationId }, id: { in: stages.flatMap(s => s.followRowId ? [s.followRowId] : []) } }, select: { id: true, sheetId: true } }),
    prisma.workflowRevision.findMany({ where: { stage: { organizationId: actor.organizationId }, id: { in: transfers.map(t => t.sourceRevisionId) } }, select: { id: true, stageId: true, number: true } }),
    prisma.patternRevision.findMany({ where: { project: { organizationId: actor.organizationId }, id: { in: transfers.map(t => t.sourceVersionKey) } }, select: { id: true, projectId: true, stageRevisionId: true, number: true } }),
    prisma.user.findMany({ where: { organizationId: actor.organizationId, id: { in: transfers.map(t => t.createdBy) } }, select: { id: true, name: true } }),
  ]);
  return transfers.map(t => {
    const outgoing = t.sourceStageId === stageId;
    const source = stages.find(s => s.id === t.sourceStageId), destination = stages.find(s => s.id === t.targetStageId);
    const linked = outgoing ? destination : source;
    const row = rows.find(r => r.id === linked?.followRowId);
    const revision = revisions.find(r => r.id === t.sourceRevisionId && r.stageId === source?.id);
    const pattern = patterns.find(p => p.id === t.sourceVersionKey && p.projectId === source?.projectId && p.stageRevisionId === revision?.id);
    const query = new URLSearchParams();
    if (row) query.set("rowId", row.id);
    if (!outgoing && revision) query.set("stageRevision", revision.id);
    const path = linked?.projectId && projects.some(p => p.id === linked.projectId) ? `/projects/${linked.projectId}` : row ? `/orders/follow/${row.sheetId}` : null;
    const snapshot = JSON.parse(t.snapshotJson) as { basis?: unknown };
    return { id: t.id, outgoing, kind: STAGE_LABELS[linked?.kind ?? (outgoing ? t.kind : "")] ?? "来源待核对", batchKey: t.batchKey,
      href: path ? `${path}${query.size ? `?${query}` : ""}#stage-materials` : null,
      sourceRevisionId: t.sourceRevisionId,
      versionLabel: [pattern ? patternEdition(pattern.number) : "", revision ? `用料第 ${revision.number} 次记录` : "来源版次待核对"].filter(Boolean).join(" · "),
      basis: typeof snapshot.basis === "string" ? snapshot.basis : "", actor: users.find(u => u.id === t.createdBy)?.name ?? "历史用户", createdAt: t.createdAt.toISOString() };
  });
}

export async function saveStageMaterials(actor: TradeActor, input: { target: unknown; expectedStamp: string; rows: unknown; reason: string; ownerId: string; uploads?: ConstructionUpload[]; requestKey: string }) {
  const target = StageTarget.parse(input.target), reason = input.reason.trim();
  if (!reason || reason.length > 2000 || !/^[\w-]{8,80}$/.test(input.requestKey)) throw new ExecutionError("请填写修改说明，并重新打开有效表单");
  const files: string[] = [], requestHash = sha256(JSON.stringify({ ...input, uploads: input.uploads?.map(u => ({ key: u.key, name: u.name, hash: sha256(u.bytes.toString("base64")) })) }));
  const auditId = `workflow-save-${sha256(`${actor.organizationId}:${actor.userId}:${input.requestKey}`)}`;
  try { return await prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, actor.organizationId); await authorizeStage(actor, db);
    const prior = await db.auditEvent.findUnique({ where: { id: auditId } });
    if (prior) { const p = JSON.parse(prior.payloadJson!); if (p.requestHash !== requestHash) throw new ExecutionError("提交标记已用于其他内容"); return p.result as { message: string; stageId: string }; }
    const data = await load(actor, target, db);
    if (data.locked) throw new ExecutionError("资料已归档或已开生产单，请在原生产单走资料修订，不能覆盖阶段记录");
    if (data.stamp !== input.expectedStamp) throw new ExecutionError("资料或规则已变化，请刷新重新核对；尚未保存");
    if (!await db.user.findFirst({ where: { id: input.ownerId, organizationId: actor.organizationId, active: true, role: { in: ["manager", "salesperson"] } } })) throw new ExecutionError("请选择本公司有效接手人");
    const stage = data.stage ?? await db.workflowStage.create({ data: { id: createId(), organizationId: actor.organizationId, ...target, styleId: data.style?.id, kind: data.kind, ownerId: input.ownerId } });
    const after = await writeConstruction(db, { organizationId: actor.organizationId, userId: actor.userId, stageId: stage.id, rows: input.rows, previous: data.rows, uploads: input.uploads, writtenFiles: files });
    const changes = describeChanges(data.rows, after);
    if (stage.ownerId !== input.ownerId) changes.push("负责人已交接");
    const revision = await db.workflowRevision.create({ data: { id: createId(), stageId: stage.id, number: (data.stage?.revisions[0]?.number ?? 0) + 1, constructionJson: JSON.stringify(after), reason, createdBy: actor.userId, sourceSnapshotJson: JSON.stringify({ ...JSON.parse(data.stage?.revisions[0]?.sourceSnapshotJson ?? JSON.stringify({ references: data.seedReferences })), target, previousRevisionId: data.stage?.revisions[0]?.id ?? null }) } });
    await db.workflowStage.update({ where: { id: stage.id }, data: { ownerId: input.ownerId, styleId: data.style?.id, updatedAt: freshTime(stage.updatedAt) } });
    for (const userId of new Set([actor.userId, stage.ownerId, input.ownerId])) await db.workflowParticipant.upsert({ where: { stageId_userId: { stageId: stage.id, userId } }, create: { stageId: stage.id, userId }, update: {} });
    if (data.project) await db.developmentProject.update({ where: { id: data.project.id }, data: { updatedAt: freshTime(data.project.updatedAt) } });
    if (data.row) await db.orderMerchSheet.update({ where: { id: data.row.sheetId }, data: { updatedAt: freshTime(data.row.sheet.updatedAt) } });
    const result = { stageId: stage.id, message: `已保存${STAGE_LABELS[data.kind]}用料与工艺第 ${revision.number} 次记录。${data.project ? "留为新版版单后可交接销售样。" : "原阶段及历史版本保持不变。"}` };
    await writeAudit({ id: auditId, organizationId: actor.organizationId, actorUserId: actor.userId, action: "workflow.materials_saved", entityType: "WorkflowStage", entityId: stage.id, summary: `保存${STAGE_LABELS[data.kind]}用料与工艺 · ${reason}`, payloadJson: JSON.stringify({ before: data.rows, after, changes, reason, beforeOwnerId: stage.ownerId, afterOwnerId: input.ownerId, basis: { target, expectedStamp: input.expectedStamp, platform: PLATFORM_CONTEXT_VERSION }, requestHash, result }) }, db);
    return result;
  }, { timeout: 30000 }); } catch (e) { await Promise.all(files.map(f => deletePrivateFile(f).catch(() => undefined))); throw e; }
}
function describeChanges(before: ReturnType<typeof readConstruction>, after: ReturnType<typeof readConstruction>) {
  return [...new Set([...before.map(r => r.key), ...after.map(r => r.key)])].flatMap(key => {
    const a = before.find(r => r.key === key), b = after.find(r => r.key === key);
    if (!a) return [`新增：${b!.name}`];
    if (!b) return [`移除：${a.name}（历史仍可查）`];
    const changes: string[] = [];
    if (a.name !== b.name) changes.push(`名称：${a.name} → ${b.name}`);
    if (a.group !== b.group) changes.push(`${b.name}：分类已修改`);
    for (const [field, label] of Object.entries(CONSTRUCTION_FIELDS)) {
      const k = field as keyof typeof a.fields;
      if ((a.fields[k] || "") !== (b.fields[k] || "")) changes.push(`${b.name} · ${label}：${a.fields[k] || "未填"} → ${b.fields[k] || "已清空"}`);
    }
    if (a.image?.id !== b.image?.id) changes.push(`${b.name}：${b.image ? "已添加或更换图片" : "已移除图片"}`);
    if (a.materialId !== b.materialId) changes.push(`${b.name}：材料引用已更换，原材料仍留档`);
    return changes;
  });
}

async function listMaterialSources(actor: TradeActor, data: Awaited<ReturnType<typeof load>>) {
  if (!data.style || data.locked) return [];
  const versions = await prisma.styleVersion.findMany({ where: { styleId: data.style.id }, orderBy: { versionNumber: "desc" }, take: 30 });
  const customerId = data.row?.sheet.customerId ?? data.project?.customerId;
  const stages = data.kind === "bulk" && customerId ? await prisma.workflowStage.findMany({ where: { organizationId: actor.organizationId, styleId: data.style.id, kind: "sales_sample" }, include: { revisions: { orderBy: { number: "desc" }, take: 10 } } }) : [];
  const followRows = await prisma.orderMerchStyle.findMany({ where: { id: { in: stages.map(s => s.followRowId!).filter(Boolean) }, sheet: { organizationId: actor.organizationId, customerId, archivedAt: null } }, include: { sheet: true } });
  return [
    ...stages.flatMap(stage => { const row = followRows.find(r => r.id === stage.followRowId); return row ? stage.revisions.map(r => ({ source: { revisionId: r.id }, label: `销售样 · ${row.sheet.title} · 第 ${r.number} 次 · ${r.reason}`, href: `/orders/follow/${row.sheetId}?row=${row.sort}#stage-materials` })) : []; }),
    ...versions.map(v => ({ source: { versionId: v.id }, label: `款式主档 · V${v.versionNumber} · ${v.status === "approved" ? "已批准（选用后仍需核对）" : "草稿"}`, href: `/styles/${data.style!.id}#style-materials` })),
  ];
}
async function materialSourceBasis(actor: TradeActor, raw: unknown, db: Db = prisma) {
  const input = StageMaterialSource.parse(raw), data = await load(actor, input.target, db);
  if (!data.style || data.style.archivedAt || data.locked) throw new ExecutionError("请关联有效款式；已开生产单或归档的资料须走原修订流程");
  const source = input.source;
  const version = "versionId" in source ? await db.styleVersion.findFirst({ where: { id: source.versionId, styleId: data.style.id }, include: { bomLines: { include: { material: true } }, attachments: true } }) : null;
  const revision = "revisionId" in source ? await db.workflowRevision.findFirst({ where: { id: source.revisionId, stage: { organizationId: actor.organizationId, styleId: data.style.id, kind: "sales_sample" } }, include: { stage: true } }) : null;
  const sourceRow = revision?.stage.followRowId ? await db.orderMerchStyle.findFirst({ where: { id: revision.stage.followRowId, sheet: { organizationId: actor.organizationId, archivedAt: null } }, include: { sheet: true } }) : null;
  if (!version && (!revision || !sourceRow || data.kind !== "bulk" || !data.row?.sheet.customerId || sourceRow.sheet.customerId !== data.row.sheet.customerId)) throw new ExecutionError("只可选本款主档，或同客户同款销售样的已保存资料");
  if (sourceRow && (await resolveStyleCodes(db, actor.organizationId, [sourceRow.styleCode])).get(sourceRow.styleCode)?.id !== data.style.id) throw new ExecutionError("来源款式关联已变化，请核对");
  const rows = version ? constructionRows(version) : readConstruction(revision!.constructionJson);
  const references = revision ? [...constructionReferences(revision.sourceSnapshotJson), ...constructionReferences(JSON.stringify({ followRow: sourceRow }))].filter((r, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(r)) === i) : version?.processNotes ? [{ label: "主档原工艺说明", text: version.processNotes, images: [] as string[] }] : [];
  if (!rows.length && !references.length) throw new ExecutionError("这份来源尚未填写用料、工艺或补充说明，请先补齐来源资料");
  const materials = await db.material.findMany({ where: { id: { in: rows.flatMap(r => r.materialId ? [r.materialId] : []) }, organizationId: actor.organizationId } });
  if (rows.some(r => r.group !== "process" && !materials.some(m => m.id === r.materialId && m.archivedAt === null))) throw new ExecutionError("来源包含已归档或不可用材料，请先修订来源资料");
  const label = version ? `款式主档 V${version.versionNumber}` : `销售样 ${sourceRow!.sheet.title} · 第 ${revision!.number} 次记录`;
  const snapshot = { sourceVersionId: version?.id ?? null, sourceStageId: revision?.stageId ?? null, sourceRevisionId: revision?.id ?? null, references, basis: input.reason, label, platformVersion: PLATFORM_CONTEXT_VERSION };
  const stamp = sha256(JSON.stringify({ input, targetStamp: data.stamp, version, revision, sourceRow, rows, materials, snapshot }));
  return { input, data, rows, snapshot, label, stamp, imageBaseUrl: version ? `/api/styles/${data.style.id}/construction/${version.id}` : `/api/workflow/stages/${revision!.stageId}/images/${revision!.id}` };
}
export async function previewStageMaterialSource(actor: TradeActor, raw: unknown) {
  const b = await materialSourceBasis(actor, raw);
  return { stamp: b.stamp, label: b.label, rows: constructionPublic(b.rows), references: b.snapshot.references, imageBaseUrl: b.imageBaseUrl, currentCount: b.data.rows.length, message: "确认后保存为本阶段新记录，替换当前用料与工艺；此前记录保留。PO、颜色数量、交期及批准不变。" };
}
export async function adoptStageMaterialSource(actor: TradeActor, raw: unknown, expectedStamp: string, requestKey: string, confirmed: boolean) {
  const input = StageMaterialSource.parse(raw);
  if (!confirmed || !/^[\w-]{8,80}$/.test(requestKey)) throw new ExecutionError("请先预览并确认选用这份资料");
  const auditId = `workflow-source-${sha256(`${actor.organizationId}:${actor.userId}:${requestKey}`)}`, requestHash = sha256(JSON.stringify({ input, expectedStamp })), files: string[] = [];
  try { return await prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, actor.organizationId); await authorizeStage(actor, db);
    const prior = await db.auditEvent.findUnique({ where: { id: auditId } });
    if (prior) { const p = JSON.parse(prior.payloadJson!); if (p.requestHash !== requestHash) throw new ExecutionError("提交标记已用于其他内容"); return p.result as { stageId: string; message: string }; }
    const b = await materialSourceBasis(actor, input, db);
    if (b.stamp !== expectedStamp) throw new ExecutionError("来源、本阶段资料或规则已变化，请重新预览确认");
    const stage = b.data.stage ?? await db.workflowStage.create({ data: { id: createId(), organizationId: actor.organizationId, ...input.target, styleId: b.data.style!.id, kind: b.data.kind, ownerId: actor.userId } });
    const after = await writeConstruction(db, { organizationId: actor.organizationId, userId: actor.userId, stageId: stage.id, rows: constructionPublic(b.rows), previous: b.rows, writtenFiles: files });
    const revision = await db.workflowRevision.create({ data: { id: createId(), stageId: stage.id, number: (b.data.stage?.revisions[0]?.number ?? 0) + 1, constructionJson: JSON.stringify(after), sourceSnapshotJson: JSON.stringify(b.snapshot), reason: `选用${b.label}：${input.reason}`, createdBy: actor.userId } });
    await db.workflowStage.update({ where: { id: stage.id }, data: { updatedAt: freshTime(stage.updatedAt) } });
    for (const userId of new Set([actor.userId, stage.ownerId])) await db.workflowParticipant.upsert({ where: { stageId_userId: { stageId: stage.id, userId } }, create: { stageId: stage.id, userId }, update: {} });
    if (b.data.project) await db.developmentProject.update({ where: { id: b.data.project.id }, data: { updatedAt: freshTime(b.data.project.updatedAt) } });
    if (b.data.row) await db.orderMerchSheet.update({ where: { id: b.data.row.sheetId }, data: { updatedAt: freshTime(b.data.row.sheet.updatedAt) } });
    const result = { stageId: stage.id, message: `已选用${b.label}，保存为第 ${revision.number} 次记录；可在本阶段继续修改。` };
    await writeAudit({ id: auditId, organizationId: actor.organizationId, actorUserId: actor.userId, action: "workflow.materials_adopted", entityType: "WorkflowStage", entityId: stage.id, summary: `选用${b.label} · ${input.reason}`, payloadJson: JSON.stringify({ before: b.data.rows, after, beforeReferences: constructionReferences(b.data.stage?.revisions[0]?.sourceSnapshotJson), afterReferences: b.snapshot.references, changes: describeChanges(b.data.rows, after), basis: b.snapshot, requestHash, result }) }, db);
    return result;
  }, { timeout: 30000 }); } catch (e) { await Promise.all(files.map(f => deletePrivateFile(f).catch(() => undefined))); throw e; }
}

async function transferBasis(actor: TradeActor, raw: unknown, db: Db = prisma) {
  const input = StageTransfer.parse(raw), data = await load(actor, input.target, db);
  if (!data.stage?.revisions[0] || !data.style || data.style.archivedAt) throw new ExecutionError("先关联已建档款式，并保存本阶段的用料与工艺");
  // Sales samples may already have a production order; bulk is a fresh batch, never an edit to that order.
  if (data.project?.archivedAt || data.row?.sheet.archivedAt || data.kind === "bulk") throw new ExecutionError("当前阶段不能继续转出，请核对原业务记录");
  let revision = data.stage.revisions[0];
  const pattern = data.project && input.patternRevisionId ? await db.patternRevision.findFirst({ where: { id: input.patternRevisionId, projectId: data.project.id } }) : null;
  if (data.project) {
    if (!pattern?.stageRevisionId) throw new ExecutionError("请选择包含用料与工艺的已留档版单；旧版请先准备修订草稿，再保存用料并留为新版");
    const frozen = await db.workflowRevision.findFirst({ where: { id: pattern.stageRevisionId, stageId: data.stage.id } });
    if (!frozen) throw new ExecutionError("此版的用料记录不完整，请核对");
    revision = frozen;
  }
  const customer = await db.customer.findFirst({ where: { id: input.customerId, organizationId: actor.organizationId, archivedAt: null } });
  const sourceCustomer = data.project?.customerId ?? data.row?.sheet.customerId;
  if (!customer || sourceCustomer && sourceCustomer !== customer.id) throw new ExecutionError("客户与原阶段不一致，请核对原业务归属");
  const owner = await db.user.findFirst({ where: { id: input.ownerId, organizationId: actor.organizationId, active: true, role: { in: ["manager", "salesperson"] } } });
  const factory = input.factoryId ? await db.party.findFirst({ where: { id: input.factoryId, organizationId: actor.organizationId, kind: "factory", archivedAt: null } }) : null;
  const kind = data.project ? "sales_sample" : "bulk";
  if (!owner || kind === "bulk" && !factory || input.factoryId && !factory) throw new ExecutionError("请选本公司有效接手人及工厂");
  const upstream = JSON.parse(revision.sourceSnapshotJson) as { pattern?: unknown };
  const snapshot = { sourceStageId: data.stage.id, sourceRevisionId: revision.id, pattern: pattern ? { id: pattern.id, number: pattern.number, craftFamily: pattern.craftFamily, sheetJson: pattern.sheetJson } : upstream.pattern ?? null, followRow: data.row ? { id: data.row.id, salesSampleJson: data.row.salesSampleJson, bulkJson: data.row.bulkJson } : null, constructionJson: revision.constructionJson, references: [...constructionReferences(revision.sourceSnapshotJson), ...constructionReferences(JSON.stringify({ followRow: data.row }))].filter((r, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(r)) === i), customerId: customer.id, basis: input.basis, platformVersion: PLATFORM_CONTEXT_VERSION };
  const stamp = sha256(JSON.stringify({ input, sourceStamp: data.stamp, snapshot, owner, factory, customer }));
  return { input, data, revision, pattern, customer, owner, factory, kind, snapshot, stamp };
}
export async function previewStageTransfer(actor: TradeActor, raw: unknown) {
  const b = await transferBasis(actor, raw);
  return { stamp: b.stamp, source: b.pattern ? patternEdition(b.pattern.number) : `销售样用料第 ${b.revision.number} 次记录`, targetKind: STAGE_LABELS[b.kind], customer: b.customer.name, owner: b.owner!.name, factory: b.factory?.name ?? "待指定", itemCount: readConstruction(b.revision.constructionJson).length, referenceCount: b.snapshot.references.length, notes: ["面料、纱线、辅料、特殊工艺及逐项图片随选定版本交接；旧表补充说明和图片也保留供核对。", "PO、颜色数量、交期、报价和批准状态不会沿用，请到新跟单填写。", "仅生成跟单草稿；不会创建生产订单、采购单或付款。"] };
}
export async function confirmStageTransfer(actor: TradeActor, raw: unknown, expectedStamp: string, requestKey: string, confirmed: boolean) {
  const input = StageTransfer.parse(raw);
  if (!confirmed || !/^[\w-]{8,80}$/.test(requestKey)) throw new ExecutionError("请先预览并明确确认本次交接");
  const requestHash = sha256(JSON.stringify({ input, expectedStamp, userId: actor.userId }));
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, actor.organizationId); await authorizeStage(actor, db);
    const prior = await db.workflowTransfer.findUnique({ where: { organizationId_requestKey: { organizationId: actor.organizationId, requestKey } } });
    if (prior) { if (prior.requestHash !== requestHash) throw new ExecutionError("提交标记已用于其他内容"); return { sheetId: prior.targetSheetId, stageId: prior.targetStageId, message: "本次交接已完成，已打开原草稿" }; }
    const b = await transferBasis(actor, input, db);
    if (b.stamp !== expectedStamp) throw new ExecutionError("资料、交接内容或规则已变化，请重新预览确认");
    const exists = await db.workflowTransfer.findUnique({ where: { sourceVersionKey_kind_batchKey: { sourceVersionKey: b.pattern?.id ?? b.revision.id, kind: b.kind, batchKey: input.batchKey } } });
    if (exists) throw new ExecutionError("同版同批次已交接，请打开交接记录中的原草稿；新批次请另填交接批次");
    const patternContent = b.pattern ? readPatternContent(b.pattern.craftFamily, b.pattern.sheetJson) : null;
    const oldSample = b.data.row ? readSalesSample(b.data.row.salesSampleJson) : null;
    const oldBulk = b.data.row ? readBulk(b.data.row.bulkJson) : null;
    const rows = readConstruction(b.revision.constructionJson), fabrics = rows.filter(r => r.group === "fabric" || r.group === "yarn");
    const composition = fabrics.map(r => `${r.name} ${r.fields.composition || ""}`.trim()).join(" / ").slice(0, 500);
    const created = await createFollowSheet({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, idempotencyKey: `stage-${sha256(requestKey)}`, kind: b.kind, title: input.title, seasonCode: input.seasonCode, customerId: input.customerId, factoryId: b.factory?.id, factoryName: b.factory?.name ?? "", initialStyles: [{ styleCode: b.data.style!.code, styleName: b.data.style!.name, craftFamily: b.data.project?.craftFamily ?? b.data.row?.craftFamily ?? "", imagePath: b.data.row?.imagePath || patternContent?.sweater.imagePath || patternContent?.fabric.imagePath || "", salesSample: { numericCode: oldSample?.numericCode ?? "", composition, note: `交接依据：${input.basis}` }, bulk: { composition: composition || oldSample?.composition || oldBulk?.composition || "", ...(oldSample ? { mainLabel: oldSample.mainLabel, pictures: { mainLabel: oldSample.pictures.mainLabel } } : {}) } }] }, db);
    const targetRow = await db.orderMerchStyle.findFirstOrThrow({ where: { sheetId: created.sheetId } });
    const stage = await db.workflowStage.create({ data: { id: createId(), organizationId: actor.organizationId, kind: b.kind, followRowId: targetRow.id, styleId: b.data.style!.id, ownerId: input.ownerId, sourceRevisionId: b.revision.id } });
    const next = await db.workflowRevision.create({ data: { id: createId(), stageId: stage.id, number: 1, constructionJson: b.revision.constructionJson, reason: `从${b.pattern ? patternEdition(b.pattern.number) : "销售样"}交接：${input.basis}`, sourceSnapshotJson: JSON.stringify(b.snapshot), createdBy: actor.userId } });
    const after = await db.workflowTransfer.create({ data: { id: createId(), organizationId: actor.organizationId, sourceStageId: b.data.stage!.id, sourceRevisionId: b.revision.id, sourceVersionKey: b.pattern?.id ?? b.revision.id, targetStageId: stage.id, targetSheetId: created.sheetId, targetRowId: targetRow.id, kind: b.kind, batchKey: input.batchKey, requestKey, requestHash, snapshotJson: JSON.stringify(b.snapshot), createdBy: actor.userId } });
    for (const stageId of [b.data.stage!.id, stage.id]) for (const userId of new Set([actor.userId, input.ownerId, b.data.stage!.ownerId])) await db.workflowParticipant.upsert({ where: { stageId_userId: { stageId, userId } }, create: { stageId, userId }, update: {} });
    for (const stageId of [b.data.stage!.id, stage.id]) await writeAudit({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "workflow.transferred", entityType: "WorkflowStage", entityId: stageId, summary: `交接${STAGE_LABELS[b.kind]} · ${input.title}`, payloadJson: JSON.stringify({ before: null, after, changes: [`接手人：${b.owner!.name}`, `交接依据：${input.basis}`, "新批次 PO、数量和交期待填写"], basis: b.snapshot, targetRevisionId: next.id }) }, db);
    return { sheetId: created.sheetId, stageId: stage.id, message: `已生成${STAGE_LABELS[b.kind]}草稿，请接手人补齐本次颜色、数量、PO 和交期` };
  }, { timeout: 30000 });
}

export async function markStageRead(actor: TradeActor, stageId: string, auditIds: string[]) {
  if (auditIds.length > 100) throw new ExecutionError("一次最多核对 100 条记录");
  return prisma.$transaction(async db => {
    await authorizeStage(actor, db);
    const stage = await db.workflowStage.findFirst({ where: { id: stageId, organizationId: actor.organizationId } });
    if (!stage) throw new ExecutionError("阶段不存在");
    const events = await db.auditEvent.findMany({ where: { id: { in: auditIds }, organizationId: actor.organizationId, entityType: "WorkflowStage", entityId: stageId } });
    if (events.length !== new Set(auditIds).size) throw new ExecutionError("记录不属于此阶段");
    for (const e of events) await db.workflowRead.upsert({ where: { auditId_userId: { auditId: e.id, userId: actor.userId } }, create: { organizationId: actor.organizationId, auditId: e.id, userId: actor.userId }, update: {} });
    return { message: "已标记本人已阅；不是审批或客户确认" };
  });
}
export async function readStageImage(actor: TradeActor, stageId: string, revisionId: string, key: string) {
  if (actor.role === "factory") {
    const user = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, role: "factory", active: true, factoryId: actor.factoryId ?? "__none__" } });
    if (!user?.factoryId || !await prisma.patternSample.findFirst({ where: { factoryId: user.factoryId, issuedAt: { not: null }, project: { organizationId: actor.organizationId }, revision: { stageRevisionId: revisionId } } })) throw new ExecutionError("无权读取本版图片");
  } else await authorizeStage(actor);
  const revision = await prisma.workflowRevision.findFirst({ where: { id: revisionId, stageId, stage: { organizationId: actor.organizationId } } });
  const image = readConstruction(revision?.constructionJson).find(r => r.key === key)?.image;
  if (!image) throw new ExecutionError("图片不存在或无权读取");
  return { ...image, bytes: await readPrivateFile(image.path) };
}

export async function stageUpdates(actor: TradeActor) {
  if (!["manager", "salesperson"].includes(actor.role)) return [];
  await authorizeStage(actor);
  const events = await prisma.$queryRaw<Array<{ id: string; summary: string; stageId: string; kind: string; projectId: string | null; followRowId: string | null }>>`
    SELECT a.id,a.summary,s.id AS stageId,s.kind,s.projectId,s.followRowId FROM AuditEvent a
    JOIN WorkflowStage s ON a.entityType='WorkflowStage' AND a.entityId=s.id AND a.organizationId=s.organizationId
    JOIN WorkflowParticipant p ON p.stageId=s.id AND p.userId=${actor.userId}
    WHERE s.organizationId=${actor.organizationId} AND a.actorUserId<>${actor.userId}
      AND NOT EXISTS (SELECT 1 FROM WorkflowRead r WHERE r.auditId=a.id AND r.userId=${actor.userId})
    ORDER BY a.createdAt DESC,a.id DESC LIMIT 20`;
  return Promise.all(events.map(async e => {
    const row = e.followRowId ? await prisma.orderMerchStyle.findUnique({ where: { id: e.followRowId } }) : null;
    return { id: e.id, summary: e.summary, kind: STAGE_LABELS[e.kind], href: e.projectId ? `/projects/${e.projectId}#stage-materials` : row ? `/orders/follow/${row.sheetId}?rowId=${row.id}#stage-materials` : "/orders" };
  }));
}
