import { PLATFORM_CONTEXT_VERSION } from "@/server/context/platform";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTION_TYPES } from "@/lib/constants";
import { createId, sha256 } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { tradePermissions } from "./trade-db";
import type { TradeActor } from "./trade-contract";

export const ORDER_ASSISTANT_ORIGIN = "order-assistant";
const Request = z.string().trim().min(5).max(1000);
const Key = z.string().trim().min(8).max(120);
const Candidate = z.string().min(1).max(120);
type Db = Prisma.TransactionClient;

async function authorize(db: Db, actor: TradeActor) {
  const user = await db.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, active: true, role: actor.role } });
  if (!user || !canApproveAction(user.role, ACTION_TYPES.createOrderDraft)) throw new Error("当前用户无权使用一句话建单");
  return user;
}

async function context(db: Db, actor: TradeActor, rawText: string) {
  await authorize(db, actor);
  const text = Request.parse(rawText);
  const customers = await db.customer.findMany({ where: { organizationId: actor.organizationId, archivedAt: null }, select: { id: true, name: true, code: true } });
  const matches = customers.filter(c => text.includes(c.name) || text.includes(c.code));
  if (matches.length !== 1) throw new Error(matches.length ? "客户名称有歧义，请只写一个客户的完整名称或编码" : "没有匹配到客户，请写已有客户的完整名称或编码");
  const customer = matches[0];
  const styleCodes = text.match(/ST-[A-Za-z0-9-]+/gi) ?? [];
  const tokens = ["针织", "T恤", "T-shirt", "毛衣", "梭织", "衬衫", "裤", "裙", "外套"].filter(t => text.toLowerCase().includes(t.toLowerCase()));
  if (!styleCodes.length && !tokens.length) throw new Error("请写清款类（例如针织 T恤）或已有款号");
  const lines = await db.orderLine.findMany({
    where: {
      order: { organizationId: actor.organizationId, customerId: customer.id, status: { not: "draft" } },
      style: { organizationId: actor.organizationId, archivedAt: null },
      version: { status: "approved" },
    },
    orderBy: [{ order: { createdAt: "desc" } }, { id: "asc" }], take: 101,
    include: { order: { select: { id: true, orderNo: true } }, style: { select: { id: true, code: true, name: true, category: true } },
      version: { include: { bomLines: { orderBy: { id: "asc" }, include: { material: { select: { id: true, organizationId: true, code: true, name: true } } } } } },
      colors: { orderBy: { id: "asc" }, include: { sizes: { orderBy: { sizeCode: "asc" }, select: { sizeCode: true } } } },
    },
  });
  const canReadTerms = (await tradePermissions(actor, db)).has("trade_view");
  const contracts = canReadTerms ? await db.tradeContract.findMany({
    where: { organizationId: actor.organizationId, order: { customerId: customer.id, organizationId: actor.organizationId, status: { not: "draft" } } },
    select: { id: true, version: true, terms: true, order: { select: { id: true, orderNo: true } } },
    orderBy: { updatedAt: "desc" }, take: 10,
  }) : [];
  const candidates = lines.slice(0, 100).filter(line => {
    if (!line.version || line.version.styleId !== line.styleId || line.version.bomLines.some(b => b.material.organizationId !== actor.organizationId)) return false;
    if (styleCodes.length) return styleCodes.some(code => code.toLowerCase() === line.style.code.toLowerCase());
    const haystack = `${line.style.name} ${line.style.category}`.toLowerCase();
    return tokens.some(t => haystack.includes(t.toLowerCase()));
  }).map(line => ({
    id: line.id, orderId: line.order.id, orderNo: line.order.orderNo,
    styleId: line.style.id, styleCode: line.style.code, styleName: line.style.name,
    versionId: line.version!.id, versionNumber: line.version!.versionNumber,
    specNotes: line.version!.specNotes, processNotes: line.version!.processNotes,
    constructionJson: line.version!.constructionJson,
    cuffType: line.version!.cuffType, patternRevision: line.version!.patternRevision,
    colors: line.colors.map(c => c.colorName),
    sizes: [...new Set(line.colors.flatMap(c => c.sizes.map(s => s.sizeCode)))],
    materials: line.version!.bomLines.map(b => ({ materialId: b.materialId, code: b.material.code, name: b.material.name,
      consumption: b.consumption.toString(), unit: b.unit, includesAllowance: b.includesAllowance,
      allowanceRate: b.allowanceRate?.toString() ?? null, colorScope: b.colorScope })),
  }));
  return { customer, candidates, limited: lines.length > 100, canReadTerms, contracts,
    sampleStatement: /基础样.{0,3}已确认/.test(text) && !/未确认|尚未|没有确认/.test(text),
  };
}

function termsReference(data: Awaited<ReturnType<typeof context>>, orderId: string) {
  const exact = data.contracts.find(c => c.order.id === orderId);
  const unique = new Set(data.contracts.map(c => c.terms.trim()).filter(Boolean));
  const chosen = exact?.terms.trim() ? exact : unique.size === 1 ? data.contracts.find(c => c.terms.trim()) : null;
  return chosen ? { contractId: chosen.id, version: chosen.version, orderId: chosen.order.id, orderNo: chosen.order.orderNo, terms: chosen.terms } : null;
}

export async function searchOrderAssistant(actor: TradeActor, text: string) {
  return prisma.$transaction(async db => {
    const data = await context(db, actor, text);
    return { customer: data.customer, limited: data.limited, modeLabel: "本地资料匹配，未调用真实模型",
      candidates: data.candidates.map(c => ({ ...c, terms: termsReference(data, c.orderId), termsNotice: data.canReadTerms ? "历史账期仅供本单核对；无记录或存在不同约定时不默认带入" : "尚无财务查阅权限，账期交经理或财务核对" })),
    };
  });
}

async function snapshot(db: Db, actor: TradeActor, text: string, candidateId: string) {
  const data = await context(db, actor, text);
  const selected = data.candidates.find(c => c.id === candidateId);
  if (!selected) throw new Error("所选历史资料不可用，请重新匹配；不能使用其他客户或未批准的资料");
  const terms = termsReference(data, selected.orderId);
  // Restricted financial text stays in the permission-checked response, not shared proposals or order notes.
  const termsBasis = terms ? { contractId: terms.contractId, version: terms.version, orderId: terms.orderId, orderNo: terms.orderNo, hash: sha256(terms.terms) } : null;
  const latestApproved = await db.styleVersion.findFirst({ where: { styleId: selected.styleId, status: "approved" }, orderBy: { versionNumber: "desc" }, select: { id: true } });
  const contextPointers = await db.organizationPolicy.findMany({ where: { organizationId: actor.organizationId, key: { in: ["context:active:company", "context:active:order"] } }, orderBy: { key: "asc" }, select: { key: true, valueJson: true } });
  const value = { context: { platformVersion: PLATFORM_CONTEXT_VERSION, pointers: contextPointers }, customer: data.customer, selected, termsBasis, latestApprovedId: latestApproved?.id ?? null, sampleStatement: data.sampleStatement };
  return { value, terms, fingerprint: sha256(JSON.stringify(value)) };
}

export async function previewOrderAssistant(actor: TradeActor, raw: { text: string; candidateId: string; idempotencyKey: string }) {
  const text = Request.parse(raw.text), candidateId = Candidate.parse(raw.candidateId), key = Key.parse(raw.idempotencyKey);
  return prisma.$transaction(async db => {
    await authorize(db, actor);
    // Take the SQLite write lock before checking idempotency and reading the source snapshot.
    await db.$executeRaw`UPDATE Organization SET id=id WHERE id=${actor.organizationId}`;
    const idempotencyKey = `order-assistant:${actor.userId}:${key}`;
    const requestHash = sha256(JSON.stringify({ text, candidateId }));
    const existing = await db.actionProposal.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey } } });
    if (existing) {
      if (JSON.parse(existing.payloadJson).requestHash !== requestHash) throw new Error("同一请求已用于另一份内容，请重新生成预览");
      if (existing.status !== "preview") throw new Error("这份预览已处理，请重新匹配");
      const current = await snapshot(db, actor, text, candidateId);
      if (JSON.parse(existing.payloadJson).fingerprint !== current.fingerprint) throw new Error("资料已变化，请重新匹配");
      return { proposalId: existing.id, candidate: current.value.selected, terms: current.terms };
    }
    const basis = await snapshot(db, actor, text, candidateId);
    const source = await db.sourceDocument.create({ data: { id: createId(), organizationId: actor.organizationId,
      contentHash: sha256(idempotencyKey), origin: ORDER_ASSISTANT_ORIGIN, mimeType: "text/plain", rawText: text,
      receivedAt: new Date(), parseStatus: "succeeded" } });
    const job = await db.aiJob.create({ data: { id: createId(), organizationId: actor.organizationId, sourceDocumentId: source.id,
      mode: "mock", provider: "local-business-rules", status: "succeeded" } });
    const proposal = await db.actionProposal.create({ data: { id: createId(), organizationId: actor.organizationId,
      aiJobId: job.id, sourceDocumentId: source.id, actionType: ACTION_TYPES.createOrderDraft, idempotencyKey, status: "preview",
      payloadJson: JSON.stringify({ userId: actor.userId, text, candidateId, requestHash, fingerprint: basis.fingerprint }),
      evidenceJson: JSON.stringify({ customerName: basis.value.customer.name, styleCode: basis.value.selected.styleCode, sourceOrderNo: basis.value.selected.orderNo }),
      expectedJson: JSON.stringify({ assistant: ORDER_ASSISTANT_ORIGIN }),
      risksJson: JSON.stringify(["历史资料只作参考，基础样确认不是本单批准", "件数、颜色、尺码数量、交期尚未填写", "账期只建来源引用，待经理或财务核对"]), approvalRequired: true,
    } });
    await db.auditEvent.create({ data: { id: createId(), organizationId: actor.organizationId, actorUserId: actor.userId,
      actorType: "user", action: "order.assistant_preview_created", entityType: "ActionProposal", entityId: proposal.id,
      summary: "一句话建单预览，尚未创建订单", payloadJson: JSON.stringify({ before: null, after: { proposalId: proposal.id, sourceId: source.id, ...basis.value }, fingerprint: basis.fingerprint }) } });
    return { proposalId: proposal.id, candidate: basis.value.selected, terms: basis.terms };
  });
}

export async function confirmOrderAssistant(actor: TradeActor, raw: { proposalId: string; confirmed: boolean }) {
  if (raw.confirmed !== true) throw new Error("请先核对资料并明确确认提交");
  const proposalId = Candidate.parse(raw.proposalId);
  return prisma.$transaction(async db => {
    await authorize(db, actor);
    await db.$executeRaw`UPDATE Organization SET id=id WHERE id=${actor.organizationId}`;
    const proposal = await db.actionProposal.findFirst({ where: { id: proposalId, organizationId: actor.organizationId, actionType: ACTION_TYPES.createOrderDraft }, include: { source: true, execution: true } });
    if (!proposal || proposal.source.origin !== ORDER_ASSISTANT_ORIGIN) throw new Error("建单预览不存在");
    const payload = JSON.parse(proposal.payloadJson) as { userId: string; text: string; candidateId: string; fingerprint: string };
    if (payload.userId !== actor.userId) throw new Error("请由发起这份预览的跟单员确认");
    if (proposal.execution) return JSON.parse(proposal.execution.resultJson) as { orderId: string; orderNo: string };
    if (proposal.status !== "preview") throw new Error("预览已失效或已拒绝，请重新匹配");
    const basis = await snapshot(db, actor, payload.text, payload.candidateId);
    if (basis.fingerprint !== payload.fingerprint) throw new Error("历史资料、账期或权限已变化，请重新匹配并确认");
    const { selected, customer, termsBasis, sampleStatement } = basis.value;
    const latest = await db.styleVersion.findFirst({ where: { styleId: selected.styleId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
    const version = await db.styleVersion.create({ data: { id: createId(), styleId: selected.styleId,
      versionNumber: (latest?.versionNumber ?? 0) + 1, status: "draft", sourceDocumentId: proposal.sourceDocumentId,
      constructionJson: selected.constructionJson,
      cuffType: selected.cuffType, specNotes: selected.specNotes, processNotes: selected.processNotes, patternRevision: selected.patternRevision,
      changeSummary: `参考 ${selected.orderNo} / V${selected.versionNumber}，本单必须重新确认`,
      bomLines: { create: selected.materials.map(m => ({ id: createId(), materialId: m.materialId, consumption: m.consumption,
        unit: m.unit, includesAllowance: m.includesAllowance, allowanceRate: m.allowanceRate, colorScope: m.colorScope, confirmed: false })) },
    } });
    const numbers = await db.salesOrder.findMany({ where: { organizationId: actor.organizationId }, select: { orderNo: true } });
    const max = numbers.reduce((n, o) => Math.max(n, Number(/^DEMO-ORD-(\d+)$/.exec(o.orderNo)?.[1] ?? 0)), 0);
    const orderNo = `DEMO-ORD-${String(max + 1).padStart(3, "0")}`;
    const termsNote = termsBasis ? `账期参考来源：${termsBasis.orderNo}；经理/财务核对后在本单收付填写，未创建合同或应收。` : "账期待经理/财务核对，未默认沿用。";
    const order = await db.salesOrder.create({ data: { id: createId(), organizationId: actor.organizationId, orderNo,
      customerId: customer.id, createdByUserId: actor.userId, sourceDocumentId: proposal.sourceDocumentId,
      status: "draft", productionReadiness: "blocked_incomplete_spec", externalCustomerPo: null,
      notes: `一句话建单；参考 ${selected.orderNo} / ${selected.styleCode} V${selected.versionNumber}。${sampleStatement ? "跟单员陈述：基础样已确认；尚未核验本单批准凭据。" : "基础样确认待核验。"}件数未填（0 为待补，不是下单数量），历史颜色/尺码仅参考。${termsNote}`,
      lines: { create: { id: createId(), styleId: selected.styleId, styleVersionId: version.id, totalQuantity: 0,
        notes: `历史参考颜色：${selected.colors.join("、") || "未记录"}；尺码：${selected.sizes.join("、") || "未记录"}；本单数量尚未确认。` } },
    } });
    const tasks = [
      { kind: "missing_size_breakdown", title: "核对基础样凭据并补齐本单颜色、件数、色尺和交期", assigneeRole: "salesperson", blocking: true },
      { kind: "order_terms_review", title: "核对新单账期；历史约定未自动生效", assigneeRole: "manager", blocking: false },
    ];
    await db.taskItem.createMany({ data: tasks.map(t => ({ ...t, id: createId(), organizationId: actor.organizationId,
      status: "open", relatedOrderId: order.id, relatedStyleId: selected.styleId, sourceDocumentId: proposal.sourceDocumentId,
      note: t.assigneeRole === "manager" ? termsNote : `发起人 ${actor.userId}；资料批准、分色确认和经理投产放行仍须分别办理。` })) });
    const result = { orderId: order.id, orderNo };
    await db.actionExecution.create({ data: { id: createId(), proposalId: proposal.id, executedById: actor.userId, status: "succeeded", resultJson: JSON.stringify(result) } });
    await db.actionProposal.update({ where: { id: proposal.id }, data: { status: "approved", decidedAt: new Date(), decidedById: actor.userId } });
    await db.auditEvent.create({ data: { id: createId(), organizationId: actor.organizationId, actorUserId: actor.userId,
      actorType: "user", action: "order.assistant_draft_created", entityType: "SalesOrder", entityId: order.id,
      summary: `确认创建 ${orderNo} 草稿；资料未批准、未采购、未投产、未付款`,
      payloadJson: JSON.stringify({ before: null, after: { ...result, customerId: customer.id, versionId: version.id, status: "draft", totalQuantity: 0, tasks }, proposalId: proposal.id, basis: basis.value, fingerprint: basis.fingerprint }) } });
    return result;
  }, { timeout: 15000 });
}
