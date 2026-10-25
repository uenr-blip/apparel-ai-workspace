import { factoryCanReadConstructionReferenceImage } from "./production-construction-reference";
import { listPatternChoices, rememberPatternChoices, savePatternChoiceVisibility } from "./pattern-choices";
import { Prisma, type DevelopmentProject } from "@prisma/client";
import { constructionPublic, readConstruction } from "@/lib/style-construction";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import { normalizePatternSheet } from "@/server/domain/craft-sheet";
import { readSheetImage } from "./sheet-image";
import type { TradeActor } from "./trade-contract";
import { PLATFORM_CONTEXT_VERSION } from "@/server/context/platform";
import { ReferenceInput, SampleQuote, SampleFeedback, readPatternContent, fieldFits, fieldValue, patternDiff, emptyFeedback, emptyQuote, type PatternContent, type PatternReference, type PatternBoard } from "@/lib/pattern-workflow";
import { PatternReferenceRequest, applyReferenceFields, referenceInput, type PatternField } from "@/lib/pattern-workflow";
import { loadPatternCatalogSource, snapshotCatalogImage } from "./pattern-catalog";

type Db = Prisma.TransactionClient;
export class PatternError extends Error { readonly name = "PatternError"; }
export async function authorizePattern(actor: TradeActor, db: Db = prisma, allowFactory = false) {
  const user = await db.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, active: true, role: actor.role } });
  if (!user || (!canApproveAction(user.role, ACTION_TYPES.savePatternSheet) && !(allowFactory && user.role === "factory" && user.factoryId && user.factoryId === actor.factoryId))) throw new PatternError("当前账号无权处理这份版单");
  return user;
}
export async function patternContextStamp(org: string, db: Db = prisma) {
  const refs = await db.organizationPolicy.findMany({ where: { organizationId: org, key: { in: ["context:active:company", "context:active:development"] } }, orderBy: { key: "asc" }, select: { key: true, valueJson: true } });
  return sha256(JSON.stringify({ version: PLATFORM_CONTEXT_VERSION, refs }));
}
const nextStamp = (before: Date) => new Date(Math.max(Date.now(), before.getTime() + 1));
function sameStamp(actual: Date, expected: string) { if (actual.toISOString() !== expected) throw new PatternError("资料已变化，请刷新后重新核对"); }
async function checkContext(org: string, stamp: string, db: Db) { if (await patternContextStamp(org, db) !== stamp) throw new PatternError("业务规则已更新，请刷新后重新核对"); }
async function audit(db: Db, actor: TradeActor, id: string, projectId: string, action: string, before: unknown, after: unknown, fingerprint: string, result: unknown, basis?: unknown) {
  await db.auditEvent.create({ data: { id, organizationId: actor.organizationId, actorUserId: actor.userId, actorType: "user", entityType: "DevelopmentProject", entityId: projectId, action, summary: action === "development.pattern_saved" ? "保存版单草稿，保留修改前后记录" : `版单处理：${action}`, payloadJson: JSON.stringify({ before, after, fingerprint, result, basis, platformVersion: PLATFORM_CONTEXT_VERSION }) } });
}
async function mutate<T>(actor: TradeActor, projectId: string, key: string, request: unknown, run: (db: Db, project: DevelopmentProject, auditId: string, fingerprint: string) => Promise<T>, allowFactory = false): Promise<T> {
  if (!/^[\w-]{8,100}$/.test(key)) throw new PatternError("提交标记无效");
  return prisma.$transaction(async db => {
    await authorizePattern(actor, db, allowFactory);
    await db.$executeRaw`UPDATE Organization SET name=name WHERE id=${actor.organizationId}`;
    const project = await db.developmentProject.findFirst({ where: { id: projectId, organizationId: actor.organizationId } });
    if (!project) throw new PatternError("开发款式不存在或无权读取");
    const auditId = `pattern-${sha256(`${actor.organizationId}:${actor.userId}:${key}`)}`, fingerprint = sha256(JSON.stringify({ projectId, request }));
    const old = await db.auditEvent.findUnique({ where: { id: auditId } });
    if (old) { const payload = JSON.parse(old.payloadJson!); if (payload.fingerprint !== fingerprint) throw new PatternError("该提交标记已用于其他内容"); return payload.result as T; }
    return run(db, project, auditId, fingerprint);
  }, { timeout: 20000 });
}
async function validatePictures(org: string, paths: string[]) {
  for (const path of [...new Set(paths.filter(Boolean))]) {
    // Legacy main images may be project assets; new references use private sheet uploads only.
    if (!/^\/api\/sheet-images\/[\w-]{8,80}$/.test(path)) throw new PatternError("请使用本公司上传的版单图片");
    await readSheetImage(org, path.split("/").at(-1)!);
  }
}
async function resolveReferences(db: Db, org: string, family: string, raw: unknown, previous: PatternReference[] = []): Promise<PatternReference[]> {
  const refs = z.array(ReferenceInput).max(12).parse(raw);
  if (new Set(refs.map(r => r.id)).size !== refs.length) throw new PatternError("参考标记重复");
  const selected = new Set<string>();
  const result: PatternReference[] = [];
  for (const ref of refs) {
    if (ref.kind !== "catalog" && ref.catalog) throw new PatternError("参考来源类型不一致，请重新选择");
    await validatePictures(org, ref.images);
    const values: PatternReference["sourceValues"] = {};
    let sourceLabel = ref.label;
    if (ref.kind === "image") {
      if (!ref.images.length || ref.mode !== "note" || ref.fields.length || ref.sourceRevisionId) throw new PatternError("图片参考须上传图片并说明参考范围，不能凭图片认定纱线参数");
    } else if (ref.kind === "catalog") {
      if (!ref.catalog || ref.sourceRevisionId) throw new PatternError("请从款式库重新选择参考来源");
      const old = previous.find(r => r.id === ref.id && r.kind === "catalog" && r.catalog?.sourceId === ref.catalog!.sourceId && r.catalog?.materialId === ref.catalog!.materialId && r.catalog?.fingerprint === ref.catalog!.fingerprint);
      let snapshot = old?.sourceSnapshot;
      sourceLabel = old?.sourceLabel || "";
      if (!snapshot || ref.catalog.includeImage && !snapshot.images.length) {
        const source = await loadPatternCatalogSource(db, org, ref.catalog.sourceId, ref.catalog.materialId);
        if (source.sourceId !== ref.catalog.sourceId || source.materialId !== ref.catalog.materialId || source.fingerprint !== ref.catalog.fingerprint) throw new PatternError("来源资料已变化，请移除这条参考并重新选择后核对");
        sourceLabel = source.label;
        snapshot = { family: source.content.craftFamily, values: Object.fromEntries(source.fields.map(f => [f, fieldValue(source.content,f)])), images: ref.catalog.includeImage ? await snapshotCatalogImage(db,org,source) : [] };
      }
      if (ref.mode === "fields" && !ref.fields.length || ref.mode === "note" && ref.fields.length) throw new PatternError("请选择要参考的字段，或改为仅作说明");
      for (const field of ref.fields) {
        if (!fieldFits(family,field) || snapshot.family && !fieldFits(snapshot.family,field)) throw new PatternError("版单类型不兼容，请核对类型或取消不兼容字段");
        if (!snapshot.values[field]) throw new PatternError("来源没有填写这个参数，不能自动带入");
        if (selected.has(field)) throw new PatternError("同一字段有多个引用来源，请明确选定一个");
        selected.add(field); values[field] = snapshot.values[field];
      }
      const images = ref.catalog.includeImage ? snapshot.images : [];
      if (ref.images.length && JSON.stringify(ref.images) !== JSON.stringify(images)) throw new PatternError("来源参考图不匹配，请重新选择");
      await validatePictures(org,images);
      result.push({ ...ref, label: sourceLabel.slice(0,400), sourceLabel, sourceValues: values, sourceSnapshot: snapshot, images });
      continue;
    } else {
      const source = await db.patternRevision.findFirst({ where: { id: ref.sourceRevisionId, project: { organizationId: org } }, include: { project: { select: { code: true, name: true } } } });
      if (!source) throw new PatternError("引用版次不存在或无权读取，请重新选择");
      sourceLabel = `${source.project.code} ${source.project.name} · V${source.number}`;
      if (ref.mode === "fields" && !ref.fields.length) throw new PatternError("请选择要参考的字段");
      if (ref.mode === "note" && ref.fields.length) throw new PatternError("仅作说明不能同时带入字段");
      const content = readPatternContent(source.craftFamily, source.sheetJson);
      for (const field of ref.fields) {
        if (!fieldFits(family, field) || !fieldFits(source.craftFamily, field)) throw new PatternError("版单类型不兼容，请改为仅作说明或先核对类型");
        if (selected.has(field)) throw new PatternError("同一字段有多个引用来源，请明确选定一个");
        selected.add(field); values[field] = fieldValue(content, field);
      }
    }
    result.push({ ...ref, sourceLabel, sourceValues: values });
  }
  return result;
}
async function addRevision(db: Db, actor: TradeActor, project: DevelopmentProject, content: PatternContent, reason: string) {
  const latest = await db.patternRevision.findFirst({ where: { projectId: project.id }, orderBy: { number: "desc" } });
  if (content.baseRevisionId && !await db.patternRevision.findFirst({ where: { id: content.baseRevisionId, projectId: project.id } })) throw new PatternError("原版次不存在");
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const materials = await db.workflowRevision.findFirst({ where: { stage: { projectId: project.id, organizationId: actor.organizationId } }, orderBy: { number: "desc" } });
  return db.patternRevision.create({ data: { id: createId(), projectId: project.id, stageRevisionId: materials?.id, number: (latest?.number ?? 0) + 1, parentId: content.baseRevisionId, craftFamily: content.craftFamily, sheetJson: JSON.stringify(content), reason, createdBy: actor.userId, createdByName: user.name } });
}
export async function savePatternDraft(actor: TradeActor, input: { projectId: string; idempotencyKey: string; expectedUpdatedAt: string; craftFamily?: unknown; origin?: unknown; originNote?: unknown; sweater?: unknown; fabric?: unknown; references?: unknown; reason?: string; contextStamp?: string; choiceVisibility?: unknown }) {
  const normalized = normalizePatternSheet(input);
  const request = { ...input, expectedUpdatedAt: undefined, idempotencyKey: undefined };
  return mutate(actor, input.projectId, input.idempotencyKey, request, async (db, project, aid, fp) => {
    if (input.contextStamp) await checkContext(actor.organizationId, input.contextStamp, db);
    const before = readPatternContent(project.craftFamily, project.sheetJson);
    sameStamp(project.updatedAt, input.expectedUpdatedAt);
    try { await savePatternChoiceVisibility(db, actor, project.id, input.choiceVisibility, aid); }
    catch (error) { if (error instanceof z.ZodError) throw error; if (error instanceof Error && /候选/.test(error.message)) throw new PatternError(error.message); throw error; }
    const references = await resolveReferences(db, actor.organizationId, normalized.craftFamily, input.references ?? before.references.map(referenceInput), before.references);
    const next: PatternContent = { ...readPatternContent(normalized.craftFamily, normalized.sheetJson), references, baseRevisionId: before.baseRevisionId };
    const changes = patternDiff(before, next);
    if (changes.length) {
      sameStamp(project.updatedAt, input.expectedUpdatedAt);
      const oldPaths = [before.sweater.imagePath, before.fabric.imagePath];
      await validatePictures(actor.organizationId, [next.sweater.imagePath, next.fabric.imagePath].filter(path => path && !oldPaths.includes(path)));
      if (!before.baseRevisionId && project.sheetJson !== "{}" && before.craftFamily && !await db.patternRevision.count({ where: { projectId: project.id } })) {
        const baseline = await addRevision(db, actor, project, before, "历史当前版单首次留档；更早修改历史未记录");
        next.baseRevisionId = baseline.id;
      }
    }
    const saved = changes.length ? await db.developmentProject.update({ where: { id: project.id }, data: { craftFamily: normalized.craftFamily, sheetJson: JSON.stringify(next), updatedAt: nextStamp(project.updatedAt) } }) : project;
    const result = { projectId: project.id, reused: !changes.length, expectedUpdatedAt: saved.updatedAt.toISOString(), craftFamily: saved.craftFamily, message: changes.length ? "版单草稿已保存，尚未留为新版本或发厂" : Array.isArray(input.choiceVisibility) && input.choiceVisibility.length ? "候选设置已保存，只对自己生效；版单内容未变" : "版单没有新的改动" };
    // Preserve previously saved entries too when an older draft is edited for the first time.
    await rememberPatternChoices(db, actor, project, before, aid, project.updatedAt.toISOString());
    await rememberPatternChoices(db, actor, project, next, aid, saved.updatedAt.toISOString());
    await audit(db, actor, aid, project.id, "development.pattern_saved", before, next, fp, result, { reason: input.reason || "修改草稿", changes });
    return result;
  });
}
const common = { idempotencyKey: z.string().min(8).max(100), expectedUpdatedAt: z.string(), contextStamp: z.string(), confirmed: z.literal(true) };
export const PatternCommand = z.discriminatedUnion("action", [
  z.object({ ...common, action:z.literal("apply_reference"), proposalId:z.string().min(1) }).strict(),
  z.object({ ...common, action: z.literal("freeze"), reason: z.string().trim().min(1).max(400) }).strict(),
  z.object({ ...common, action: z.literal("revise"), revisionId: z.string().min(1), reason: z.string().trim().min(1).max(400) }).strict(),
  z.object({ ...common, action: z.literal("create_sample"), revisionId: z.string().min(1), factoryId: z.string().min(1), quantity: z.number().int().min(1).max(10000), dueDate: z.string().max(10), requirements: z.string().trim().max(400) }).strict(),
  z.object({ ...common, action: z.literal("update_sample"), sampleId: z.string().min(1), quote: SampleQuote, feedback: SampleFeedback, internalOpinion: z.string().trim().max(400) }).strict(),
  z.object({ ...common, action: z.literal("issue_sample"), sampleId: z.string().min(1) }).strict(),
  z.object({ ...common, action: z.literal("reassign_sample"), sampleId: z.string().min(1), ownerId: z.string().min(1), reason: z.string().trim().min(1).max(400) }).strict(),
  z.object({ idempotencyKey: z.string().min(8).max(100), action: z.literal("receive_sample"), sampleId: z.string().min(1) }).strict(),
]);
export async function patternCommand(actor: TradeActor, projectId: string, raw: unknown) {
  const input = PatternCommand.parse(raw);
  return mutate(actor, projectId, input.idempotencyKey, input, async (db, project, aid, fp) => {
    if (input.action !== "receive_sample") await checkContext(actor.organizationId, input.contextStamp, db);
    if (input.action === "apply_reference") {
      const proposal=await db.actionProposal.findFirst({where:{id:input.proposalId,organizationId:actor.organizationId,actionType:ACTION_TYPES.applyPatternReference},include:{execution:true}});
      if(!proposal)throw new PatternError("采用提案不存在");
      const expected=JSON.parse(proposal.expectedJson), payload=JSON.parse(proposal.payloadJson) as {actorId:string;projectId:string;content:PatternContent};
      if(payload.actorId!==actor.userId || payload.projectId!==projectId)throw new PatternError("只能确认自己为本款生成的采用提案");
      if(proposal.execution?.status==="succeeded")return JSON.parse(proposal.execution.resultJson) as {message:string};
      if(proposal.status!=="preview")throw new PatternError("此提案已处理，请重新核对");
      sameStamp(project.updatedAt,expected.updatedAt);await checkContext(actor.organizationId,expected.contextStamp,db);
      if(sha256(proposal.payloadJson)!==expected.payloadHash)throw new PatternError("提案内容校验失败");
      const source=await db.patternRevision.findFirst({where:{id:expected.sourceRevisionId,project:{organizationId:actor.organizationId}}});
      if(!source || sha256(source.sheetJson)!==expected.sourceHash)throw new PatternError("来源版次已变化，请重新核对");
      const before=readPatternContent(project.craftFamily,project.sheetJson),after=payload.content;
      if(!before.baseRevisionId&&project.sheetJson!=="{}"&&before.craftFamily&&!await db.patternRevision.count({where:{projectId}}))after.baseRevisionId=(await addRevision(db,actor,project,before,"采用参考前的历史当前版单留档；更早历史未记录")).id;
      await db.developmentProject.update({where:{id:projectId},data:{sheetJson:JSON.stringify(after),craftFamily:after.craftFamily,updatedAt:nextStamp(project.updatedAt)}});
      const result={projectId,message:"选中的参考已保存到本款草稿。可继续修改、留为新版，再由负责人发厂；尚未批准或采购。"};
      await db.actionProposal.update({where:{id:proposal.id},data:{status:"approved",decidedAt:new Date(),decidedById:actor.userId}});
      await db.actionExecution.create({data:{id:createId(),proposalId:proposal.id,executedById:actor.userId,status:"succeeded",resultJson:JSON.stringify(result)}});
      await audit(db,actor,aid,projectId,"pattern.reference_applied",before,after,fp,result,{proposalId:proposal.id,sourceRevisionId:source.id,changes:patternDiff(before,after)});return result;
    }
    if (input.action === "freeze" || input.action === "revise" || input.action === "create_sample") sameStamp(project.updatedAt, input.expectedUpdatedAt);
    if (input.action === "freeze") {
      const content = readPatternContent(project.craftFamily, project.sheetJson);
      if (!content.craftFamily) throw new PatternError("先选择类型并保存版单草稿");
      if (content.baseRevisionId) {
        const base = await db.patternRevision.findFirstOrThrow({ where: { id: content.baseRevisionId, projectId } });
        const materials = await db.workflowRevision.findFirst({ where: { stage: { projectId, organizationId: actor.organizationId } }, orderBy: { number: "desc" } });
        const previous = base.stageRevisionId ? await db.workflowRevision.findUnique({ where: { id: base.stageRevisionId } }) : null;
        if (!patternDiff(readPatternContent(base.craftFamily, base.sheetJson), content).length && materials?.constructionJson === previous?.constructionJson) throw new PatternError("内容与原版相同，无需新建版次；可按原版另建打样记录");
      }
      const revision = await addRevision(db, actor, project, content, input.reason);
      await db.developmentProject.update({ where: { id: projectId }, data: { sheetJson: JSON.stringify({ ...content, baseRevisionId: revision.id }), updatedAt: nextStamp(project.updatedAt) } });
      const result = { revisionId: revision.id, message: `V${revision.number} 已留档，尚未发厂，也不是资料批准` };
      await audit(db, actor, aid, projectId, "pattern.revision_created", content, revision, fp, result); return result;
    }
    if (input.action === "revise") {
      const source = await db.patternRevision.findFirst({ where: { id: input.revisionId, projectId } });
      if (!source) throw new PatternError("版次不存在");
      const content = { ...readPatternContent(source.craftFamily, source.sheetJson), baseRevisionId: source.id };
      const stage = await db.workflowStage.findFirst({ where: { projectId, organizationId: actor.organizationId }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
      if (stage) {
        const sourceMaterials = source.stageRevisionId ? await db.workflowRevision.findFirst({ where: { id: source.stageRevisionId, stageId: stage.id } }) : null;
        const after = await db.workflowRevision.create({ data: { id: createId(), stageId: stage.id, number: (stage.revisions[0]?.number ?? 0) + 1, constructionJson: sourceMaterials?.constructionJson ?? "[]", reason: `从 V${source.number} 准备修订：${input.reason}`, sourceSnapshotJson: JSON.stringify({ patternRevisionId: source.id }), createdBy: actor.userId } });
        await db.auditEvent.create({ data: { id: createId(), organizationId: actor.organizationId, actorUserId: actor.userId, actorType: "user", entityType: "WorkflowStage", entityId: stage.id, action: "workflow.materials_revised", summary: after.reason, payloadJson: JSON.stringify({ before: stage.revisions[0], after, changes: ["当前用料恢复到所选版次；历史记录保留"] }) } });
      }
      await db.developmentProject.update({ where: { id: projectId }, data: { sheetJson: JSON.stringify(content), craftFamily: source.craftFamily, updatedAt: nextStamp(project.updatedAt) } });
      const result = { message: `已从 V${source.number} 准备修订草稿，旧版及工厂记录保持不变` };
      await audit(db, actor, aid, projectId, "pattern.revision_drafted", readPatternContent(project.craftFamily, project.sheetJson), content, fp, result, input.reason); return result;
    }
    if (input.action === "create_sample") {
      const revision = await db.patternRevision.findFirst({ where: { id: input.revisionId, projectId } });
      const factory = await db.party.findFirst({ where: { id: input.factoryId, organizationId: actor.organizationId, kind: "factory" } });
      if (!revision || !factory) throw new PatternError("请选本款已留档版次和本公司工厂");
      if (input.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || isNaN(Date.parse(input.dueDate)) || new Date(input.dueDate).toISOString().slice(0,10) !== input.dueDate)) throw new PatternError("预计回样日期无效");
      const latest = await db.patternSample.findFirst({ where: { projectId, factoryId: factory.id }, orderBy: { round: "desc" } });
      const sample = await db.patternSample.create({ data: { id: createId(), projectId, revisionId: revision.id, factoryId: factory.id, round: (latest?.round ?? 0) + 1, quantity: input.quantity, dueDate: input.dueDate, requirements: input.requirements, ownerId: actor.userId, createdBy: actor.userId } });
      const result = { sampleId: sample.id, message: "已准备打样记录，由当前负责人核对后发厂" };
      await audit(db, actor, aid, projectId, "pattern.sample_prepared", null, sample, fp, result); return result;
    }
    const sample = await db.patternSample.findFirst({ where: { id: input.sampleId, projectId }, include: { revision: true } });
    if (!sample) throw new PatternError("打样记录不存在");
    if (input.action === "receive_sample") {
      if (actor.role !== "factory" || sample.factoryId !== actor.factoryId || !sample.issuedAt) throw new PatternError("只能确认本工厂已收到的打样要求");
      const next = sample.receivedAt ? sample : await db.patternSample.update({ where: { id: sample.id }, data: { receivedAt: new Date(), receivedById: actor.userId, updatedAt: nextStamp(sample.updatedAt) } });
      const result = { message: "已记录本工厂收到此版打样要求" };
      await audit(db, actor, aid, projectId, "pattern.sample_received", sample.receivedAt, next.receivedAt, fp, result); return result;
    }
    if (sample.ownerId !== actor.userId) throw new PatternError("请由这条打样记录的负责人处理");
    sameStamp(sample.updatedAt, input.expectedUpdatedAt);
    let data: Prisma.PatternSampleUpdateInput;
    if (input.action === "issue_sample") {
      if (sample.issuedAt) throw new PatternError("此打样要求已发厂，请查看原记录；改要求需另建明确版次的打样记录");
      data = { issuedAt: new Date(), issuedById: actor.userId };
    } else if (input.action === "reassign_sample") {
      if (!await db.user.findFirst({ where: { id: input.ownerId, organizationId: actor.organizationId, active: true, role: { in: ["salesperson", "manager"] } } })) throw new PatternError("请选择有效的本公司经办人");
      data = { ownerId: input.ownerId };
    } else {
      await validatePictures(actor.organizationId, input.feedback.images);
      if ((input.feedback.returnedOn || input.feedback.review !== "pending") && !sample.issuedAt) throw new PatternError("先由负责人发出打样要求，再登记回样与评价");
      if (input.feedback.review !== "pending" && (!input.feedback.returnedOn || !input.feedback.reviewNote)) throw new PatternError("评价回样须填写回样日期及评价依据");
      data = { quoteJson: JSON.stringify(input.quote), feedbackJson: JSON.stringify(input.feedback), internalOpinion: input.internalOpinion };
    }
    const next = await db.patternSample.update({ where: { id: sample.id }, data: { ...data, updatedAt: nextStamp(sample.updatedAt) } });
    const result = { sampleId: sample.id, message: input.action === "issue_sample" ? "已在系统内发给指定工厂，等待工厂确认收到；未发送外部消息" : "打样记录已保存，改动已留档" };
    await audit(db, actor, aid, projectId, `pattern.${input.action}`, sample, next, fp, result); return result;
  }, input.action === "receive_sample");
}
export async function getPatternBoard(actor: TradeActor, projectId: string): Promise<PatternBoard> {
  await authorizePattern(actor);
  const project = await prisma.developmentProject.findFirst({ where: { id: projectId, organizationId: actor.organizationId }, include: { patternRevisions: { orderBy: { number: "desc" } }, patternSamples: { orderBy: { createdAt: "desc" }, include: { revision: true } } } });
  if (!project) throw new PatternError("开发款式不存在");
  const factories = await prisma.party.findMany({ where: { organizationId: actor.organizationId, kind: "factory" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const users = await prisma.user.findMany({ where: { organizationId: actor.organizationId }, select: { id: true, name: true } });
  return { projectId, code: project.code, name: project.name, updatedAt: project.updatedAt.toISOString(), content: readPatternContent(project.craftFamily, project.sheetJson), contextStamp: await patternContextStamp(actor.organizationId), choices: await listPatternChoices(prisma, actor.organizationId, actor.userId), factories,
    revisions: project.patternRevisions.map(r => ({ id: r.id, number: r.number, parentId: r.parentId, reason: r.reason, createdAt: r.createdAt.toISOString(), createdByName: r.createdByName, content: readPatternContent(r.craftFamily, r.sheetJson) })),
    samples: project.patternSamples.map(s => ({ id: s.id, revisionId: s.revisionId, revisionNumber: s.revision.number, factoryId: s.factoryId, factoryName: factories.find(f => f.id === s.factoryId)?.name || "历史工厂", round: s.round, quantity: s.quantity, dueDate: s.dueDate, requirements: s.requirements, quote: { ...emptyQuote(), ...JSON.parse(s.quoteJson) }, feedback: { ...emptyFeedback(), ...JSON.parse(s.feedbackJson) }, internalOpinion: s.internalOpinion, updatedAt: s.updatedAt.toISOString(), ownerId: s.ownerId, ownerName: users.find(u => u.id === s.ownerId)?.name || "历史账号", issuedAt: s.issuedAt?.toISOString() ?? null, receivedAt: s.receivedAt?.toISOString() ?? null })),
  };
}
export async function findPatternReferences(actor: TradeActor, query: string) {
  await authorizePattern(actor);
  const q = z.string().trim().min(1).max(100).parse(query);
  const projects = await prisma.developmentProject.findMany({ where: { organizationId: actor.organizationId, OR: [{ code: { contains: q } }, { name: { contains: q } }, { style: { code: { contains: q } } }, { style: { name: { contains: q } } }] }, include: { patternRevisions: { orderBy: { number: "desc" }, take: 10 } }, take: 21 });
  return { limited: projects.length > 20, candidates: projects.slice(0,20).flatMap(p => p.patternRevisions.map(r => ({ id: r.id, projectId: p.id, label: `${p.code} ${p.name} · V${r.number}`, content: readPatternContent(r.craftFamily, r.sheetJson) }))), unsaved: projects.slice(0,20).filter(p => !p.patternRevisions.length).map(p => ({ id: p.id, code: p.code, name: p.name })) };
}
export async function previewPatternReference(actor:TradeActor,raw:unknown,key:string) {
  const input=PatternReferenceRequest.parse(raw);
  return mutate(actor,input.projectId,key,input,async(db,project,aid,fp)=>{
    const before=readPatternContent(project.craftFamily,project.sheetJson);
    if(!before.craftFamily)throw new PatternError("请先为本款选择版单类型并保存");
    const source=await db.patternRevision.findFirst({where:{id:input.sourceRevisionId,project:{organizationId:actor.organizationId}}});
    if(!source)throw new PatternError("参考来源不存在或无权读取");
    if(Object.keys(input.values).some(k=>!input.fields.includes(k as PatternField)))throw new PatternError("本次值只能修改已选字段");
    const refInput={id:createId(),kind:"revision",sourceRevisionId:source.id,label:"版单资料参考",images:[],mode:input.mode,fields:input.fields,scope:input.scope,exclusions:input.exclusions};
    const plain=before.references.map(referenceInput);
    const references=await resolveReferences(db,actor.organizationId,before.craftFamily,[...plain,refInput],before.references);
    const content=input.mode==="fields"?applyReferenceFields(before,readPatternContent(source.craftFamily,source.sheetJson),input.fields):{...before};
    for(const [field,value]of Object.entries(input.values)){const[group,k]=field.split(".");(content[group as "sweater"|"fabric"] as unknown as Record<string,string>)[k]=value;}
    content.references=references;
    const payloadJson=JSON.stringify({actorId:actor.userId,projectId:project.id,content});
    const contextStamp=await patternContextStamp(actor.organizationId,db);
    const sourceDoc=await db.sourceDocument.create({data:{id:createId(),organizationId:actor.organizationId,origin:"pattern-assistant",receivedAt:new Date(),mimeType:"text/plain",rawText:`${project.code} 部分资料参考：${input.scope}`,contentHash:sha256(aid),parseStatus:"succeeded"}});
    const job=await db.aiJob.create({data:{id:createId(),organizationId:actor.organizationId,sourceDocumentId:sourceDoc.id,mode:"manual",provider:"human-review",status:"succeeded"}});
    const proposal=await db.actionProposal.create({data:{id:createId(),organizationId:actor.organizationId,sourceDocumentId:sourceDoc.id,aiJobId:job.id,actionType:ACTION_TYPES.applyPatternReference,idempotencyKey:aid,status:"preview",payloadJson,evidenceJson:JSON.stringify({sourceRevisionId:source.id}),expectedJson:JSON.stringify({projectId:project.id,updatedAt:project.updatedAt.toISOString(),sourceRevisionId:source.id,sourceHash:sha256(source.sheetJson),contextStamp,payloadHash:sha256(payloadJson)}),risksJson:JSON.stringify(["只采用选中字段；基础样与资料批准需另行核对","采用后仍为草稿，不发厂、不采购"]),approvalRequired:true}});
    const result={proposalId:proposal.id,projectId:project.id,projectCode:project.code,updatedAt:project.updatedAt.toISOString(),contextStamp,changes:patternDiff(before,content),content,message:"已准备采用预览，业务版单尚未修改"};
    await audit(db,actor,aid,project.id,"pattern.reference_previewed",null,{proposalId:proposal.id,sourceRevisionId:source.id},fp,result);return result;
  });
}
/** Explicit public-to-assigned-factory projection; never spread internal records here. */
export function factoryPatternContent(content: PatternContent) {
  const fields = content.craftFamily === "sweater" ? ["yarnComposition", "yarnCount", "bodyStructure", "needleType"] : ["fabricComposition", "gsm", "spec", "width", "lining", "trims"];
  const group = content.craftFamily === "sweater" ? content.sweater : content.fabric;
  return { craftFamily: content.craftFamily, imagePath: group.imagePath, imageNote: group.imageNote, fields: fields.map(key => ({ key: `${content.craftFamily === "sweater" ? "sweater" : "fabric"}.${key}`, value: (group as unknown as Record<string,string>)[key] })), references: content.references.map(r => ({ scope: r.scope, exclusions: r.exclusions, images: r.images })) };
}
export async function getFactorySample(actor: TradeActor, projectId: string, sampleId: string) {
  await authorizePattern(actor, prisma, true);
  const sample = await prisma.patternSample.findFirst({ where: { id: sampleId, projectId, project: { organizationId: actor.organizationId }, ...(actor.role === "factory" ? { factoryId: actor.factoryId!, issuedAt: { not: null } } : {}) }, include: { revision: true, project: { select: { code: true, name: true } } } });
  if (!sample) throw new PatternError("打样要求不存在或尚未向本工厂发出");
  const current = factoryPatternContent(readPatternContent(sample.revision.craftFamily, sample.revision.sheetJson));
  const parent = sample.revision.parentId ? await prisma.patternRevision.findFirst({ where: { id: sample.revision.parentId, projectId } }) : null;
  const before = parent ? factoryPatternContent(readPatternContent(parent.craftFamily, parent.sheetJson)) : null;
  const technical = (c: typeof current) => ({ craftFamily: c.craftFamily, ...Object.fromEntries(c.fields.map(f => [f.key,f.value])), imageNote:c.imageNote, references:c.references.map(r=>`${r.scope}；不参考：${r.exclusions || "未注明"}；${r.images.length}张图`).join("\n") });
  const a = before ? technical(before) : {}, b = technical(current);
  const diff = before ? [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>(a as Record<string,string>)[k] !== (b as Record<string,string>)[k]).map(key=>({key,before:(a as Record<string,string>)[key] || "",value:(b as Record<string,string>)[key] || ""})) : [];
  if (before && before.imagePath !== current.imagePath) diff.push({ key:"imagePath",before:before.imagePath?"原款式图":"未附图",value:current.imagePath?"已更换款式图，见本版图片":"已移除" });
  const materials = sample.revision.stageRevisionId ? await prisma.workflowRevision.findFirst({ where: { id: sample.revision.stageRevisionId, stage: { projectId, organizationId: actor.organizationId } } }) : null;
  return { id: sample.id, projectId, code: sample.project.code, name: sample.project.name, revisionNumber: sample.revision.number, round: sample.round, quantity: sample.quantity, dueDate: sample.dueDate, requirements: sample.requirements, issuedAt: sample.issuedAt?.toISOString() ?? null, receivedAt: sample.receivedAt?.toISOString() ?? null, content: current, diff, materials: materials ? { stageId: materials.stageId, revisionId: materials.id, rows: constructionPublic(readConstruction(materials.constructionJson)) } : null };
}
export async function canFactorySeeSheetImage(actor:TradeActor,imageId:string) {
  await authorizePattern(actor,prisma,true);
  if(actor.role!=="factory")return true;
  const src=`/api/sheet-images/${imageId}`;
  const rows=await prisma.patternSample.findMany({where:{factoryId:actor.factoryId!,issuedAt:{not:null},project:{organizationId:actor.organizationId}},include:{revision:true}});
  if(rows.some(row=>{const c=factoryPatternContent(readPatternContent(row.revision.craftFamily,row.revision.sheetJson));return c.imagePath===src||c.references.some(r=>r.images.includes(src));}))return true;
  // Existing factory order sheets keep access to their own images.
  const sheets=await prisma.orderMerchSheet.findMany({where:{organizationId:actor.organizationId,order:{factoryId:actor.factoryId!}},include:{styles:true}});
  if (sheets.some(sheet=>JSON.stringify([sheet.salesSampleJson,sheet.bulkJson,...sheet.styles.map(s=>[s.imagePath,s.labDipJson,s.salesSampleJson,s.bulkJson])]).includes(imageId))) return true;
  return factoryCanReadConstructionReferenceImage(actor.organizationId, actor.factoryId!, src);
}
