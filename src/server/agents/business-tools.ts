import { CONSTRUCTION_LABELS, CONSTRUCTION_FIELDS, constructionPublic, readConstruction } from "@/lib/style-construction";
import { listFactoryTransfers } from "@/server/services/factory-transfer";
import { partnerTools } from "./partner-tools";
import { workflowTools } from "./workflow-tools";
import { stageExpenseTools } from "./stage-expense-tools";
import { followTools } from "./follow-tools";
import type { FollowSuggestion } from "@/lib/follow-assistant";
import type { AgentTable } from "@/lib/agent-table";
import { patternTools } from "./pattern-tools";
import type { PatternSuggestion } from "@/lib/pattern-workflow";
import { workspaceTools } from "./workspace-tools";
import { formatMoney as money } from "@/lib/trade-money";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTrade, billCte, cashCte, type BillRow, type CashRow } from "@/server/services/trade-db";
import type { TradeActor } from "@/server/services/trade-contract";
import { searchOrderAssistant } from "@/server/services/order-assistant";
import type { AgentTool } from "./runtime";

export const Module = z.enum(["order", "development", "scheduling", "finance", "review", "workspace", "product", "production", "follow"]);
export type AgentModule = z.infer<typeof Module>;
export type EvidenceCard = { title: string; href?: string; facts: string[] };
const Query = z.object({ query: z.string().trim().min(1).max(100) }).strict();
const Identity = z.object({ id: z.string().min(1).max(120) }).strict();
const querySchema = { type: "object", properties: { query: { type: "string", description: "从原话提取的客户名称/编码、订单号或款号/款名关键词，不要整句；不知道就请用户补充" } }, required: ["query"], additionalProperties: false };
const idSchema = { type: "object", properties: { id: { type: "string", description: "前一步查询返回的唯一候选 ID" } }, required: ["id"], additionalProperties: false };
const cut = (text: string | null | undefined) => (text || "未记录").slice(0, 900);

export async function authorizeAgent(actor: TradeActor, module: AgentModule) {
  const user = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, role: actor.role, active: true } });
  if (!user || !["manager", "salesperson"].includes(user.role)) throw new Error("当前账号无权使用这个智能体入口");
  if (module === "finance") await requireTrade(actor);
}

export type BusinessToolRegistry = {
  tools: AgentTool[]; cards: EvidenceCard[]; tables: AgentTable[]; hasEvidence: () => boolean;
  incompleteEvidence?: () => string | null;
  getOrderGuidance?: () => string | null;
  getOrderResult: () => (Awaited<ReturnType<typeof searchOrderAssistant>> & { resolvedText: string }) | null;
  getFollowDraft?: () => FollowSuggestion | null;
  getPatternSuggestion?: () => PatternSuggestion | null;
};
function combined(groups: Array<{ prefix: string; registry: BusinessToolRegistry }>): BusinessToolRegistry {
  return { tools: groups.flatMap(({ prefix, registry }) => registry.tools.map(tool => ({ ...tool, name: `${prefix}_${tool.name}` }))), get cards() { return groups.flatMap(g => g.registry.cards); }, get tables() { return groups.flatMap(g => g.registry.tables); }, hasEvidence: () => groups.some(g => g.registry.hasEvidence()), getOrderResult: () => null, getPatternSuggestion: () => groups.map(g=>g.registry.getPatternSuggestion?.()).find(Boolean) ?? null };
}

/** Registry is constructed per request; IDs must come from this request's scoped lookup. */
export function businessTools(actor: TradeActor, module: AgentModule, originalText: string): BusinessToolRegistry {
  if (module === "follow") {
    const follow = followTools(actor, () => authorizeAgent(actor, module)), stages = workflowTools(actor);
    return { ...follow, tools: [...follow.tools, ...stages.tools], get tables() { return [...follow.tables, ...stages.tables]; }, get cards() { return [...follow.cards, ...stages.cards]; }, hasEvidence: () => follow.hasEvidence() || stages.hasEvidence() };
  }
  if (module === "product") return combined([{ prefix: "styles", registry: businessTools(actor,"development",originalText) }, { prefix: "review", registry: businessTools(actor,"review",originalText) }, { prefix:"pattern",registry:patternTools(actor) }, { prefix: "workflow", registry: workflowTools(actor) }]);
  if (module === "production") return combined([{ prefix: "schedule", registry: businessTools(actor,"scheduling",originalText) }, { prefix: "progress", registry: workspaceTools(actor, () => authorizeAgent(actor,"workspace"), originalText) }]);
  if (module === "workspace") {
    const progress=workspaceTools(actor, () => authorizeAgent(actor,module), originalText),partners=partnerTools(actor),stages=workflowTools(actor);
    return {tools:[...progress.tools,...partners.tools,...stages.tools],get tables(){return [...progress.tables,...partners.tables,...stages.tables];},get cards(){return [...progress.cards,...partners.cards,...stages.cards];},hasEvidence:()=>progress.hasEvidence()||partners.hasEvidence()||stages.hasEvidence(),getOrderResult:()=>null};
  }
  const cards: EvidenceCard[] = [], selected = new Set<string>();
  const tables: AgentTable[] = [];
  let orderResult: (Awaited<ReturnType<typeof searchOrderAssistant>> & { resolvedText: string }) | null = null;
  let evidenceRead = false;
  let orderGuidance: string | null = null;
  const checkId = (raw: unknown) => { const { id } = Identity.parse(raw); if (!selected.has(id)) throw new Error("请先查询并选定唯一业务对象，不能猜测记录编号"); return id; };
  const tool = (name: string, description: string, parameters: Record<string, unknown>, run: AgentTool["run"]): AgentTool => ({ name, description, parameters, run: async args => { await authorizeAgent(actor, module); return run(args); } });
  const lookup = tool("find_records", module === "order" ? "查找建单客户：query只填客户名称或客户编码，不填款号、款名、品类或整句。唯一匹配后必须调用read_evidence读取历史资料" : "查找客户、订单或款式候选", module === "order" ? { ...querySchema, properties: { query: { type: "string", description: "仅客户名称或编码，例如北岸服饰；针织T恤是品类，不能用来查客户" } } } : querySchema, async raw => {
    const { query } = Query.parse(raw);
    selected.clear();
    if (module === "order") { orderResult = null; evidenceRead = false; orderGuidance = null; }
    if (module === "order" || module === "finance") {
      const rows = await prisma.customer.findMany({ where: { organizationId: actor.organizationId, OR: [{ name: { contains: query } }, { code: { contains: query } }] }, select: { id: true, name: true, code: true }, take: 21 });
      if (rows.length === 1) selected.add(rows[0].id);
      if (module === "order") orderGuidance = rows.length === 1 ? null : rows.length ? "找到多个客户，请补充唯一客户编码，再读取历史订单资料；当前尚未准备建单参考。" : "没有找到匹配客户，请核对客户名称或编码；当前尚未读取历史订单资料。";
      cards.push(...rows.slice(0, 20).map(r => ({ title: `${r.code} ${r.name}`, facts: [rows.length === 1 ? "客户已唯一匹配" : "客户有歧义，请写完整名称或编码"] })));
      tables.push({ title: `客户匹配 · ${query}`, columns: ["客户编码", "客户", "匹配状态"], rows: rows.slice(0, 20).map(r => ({ cells: [r.code, r.name, rows.length === 1 ? "唯一匹配" : "待补充完整名称或编码"] })), notes: rows.length > 20 ? ["仅显示前 20 位客户，请缩小查询范围。"] : [], emptyMessage: "没有找到该客户，请核对名称或编码；尚未查询账目或历史订单。" });
      return { candidates: rows.slice(0, 20), limited: rows.length > 20, requiresClarification: rows.length !== 1, ...(module === "order" ? { nextStep: rows.length === 1 ? "客户已唯一匹配，接下来调用read_evidence并传入本次返回的客户id；尚未查询历史资料，不能直接结束。" : "只向用户核对客户名称或编码，不能改用款号、品类查询客户。" } : {}) };
    }
    if (module === "scheduling") {
      const rows = await prisma.salesOrder.findMany({ where: { organizationId: actor.organizationId, orderNo: { contains: query } }, select: { id: true, orderNo: true, requestedDeliveryDate: true, status: true }, take: 21 });
      if (rows.length === 1) selected.add(rows[0].id);
      cards.push(...rows.slice(0, 20).map(r => ({ title: r.orderNo, href: `/orders/${r.id}`, facts: [rows.length === 1 ? "订单已唯一匹配" : "请写完整订单号"] })));
      tables.push({ title: `订单匹配 · ${query}`, columns: ["订单", "要求交期", "匹配状态"], rows: rows.slice(0, 20).map(r => ({ href: `/orders/${r.id}`, cells: [r.orderNo, r.requestedDeliveryDate || "待确认", rows.length === 1 ? "唯一匹配" : "待补充完整订单号"] })), notes: rows.length > 20 ? ["仅显示前 20 单，请缩小查询范围。"] : [], emptyMessage: "没有找到该订单，请核对完整订单号。" });
      return { candidates: rows.slice(0, 20), limited: rows.length > 20, requiresClarification: rows.length !== 1 };
    }
    const rows = await prisma.style.findMany({ where: { organizationId: actor.organizationId, OR: [{ code: { contains: query } }, { name: { contains: query } }, { silhouette: { contains: query } }, { category: { contains: query } }] }, include: { yearOption: true }, take: 21, orderBy: { code: "asc" } });
    const matches = rows.slice(0, 20).map(r => ({ id: r.id, code: r.code, name: r.name, category: r.category, silhouette: r.silhouette, developmentYear: r.yearOption?.name ?? null }));
    // Similarity search may compare multiple candidates; review must first identify a unique style.
    if (module === "development" || rows.length === 1) for (const row of matches) selected.add(row.id);
    cards.push(...matches.map(r => ({ title: `${r.code} ${r.name}`, href: `/styles/${r.id}`, facts: [`资料匹配：${cut(r.category)} / ${cut(r.silhouette)}`, `开发年份：${r.developmentYear || "未记录，不能据导入时间判断去年款"}`, module === "review" && rows.length !== 1 ? "请选定款号再查审版" : "可继续核对版次资料"] })));
    tables.push({ title: `款式候选 · ${query}`, columns: ["款号", "款名", "品类", "版型", "开发年份"], rows: matches.map(r => ({ href: `/styles/${r.id}`, cells: [r.code, r.name, r.category, r.silhouette, r.developmentYear] })), notes: ["按文字和结构匹配，采用前需重新确认；年份未记录时不能据导入时间判断去年款。", ...(module === "review" && rows.length !== 1 ? ["请补充唯一款号后查询审版。"] : []), ...(rows.length > 20 ? ["仅显示前 20 款，请缩小查询范围。"] : [])], emptyMessage: "没有找到符合关键词的款式，请补充款号或调整描述。" });
    return { candidates: matches, limited: rows.length > 20, requiresClarification: module === "review" && rows.length !== 1 };
  });
  const detail = tool("read_evidence", module === "order" ? "读取客户已批准的历史订单参考资料" : module === "finance" ? "核对已确认款项与未分配收款（只读）" : module === "scheduling" ? "读取交期、工厂在手订单和历史产量" : "读取款式版次、批准凭据和变更历史", idSchema, async raw => {
    const id = checkId(raw);
    if (module === "order") {
      const customer = await prisma.customer.findFirstOrThrow({ where: { id, organizationId: actor.organizationId } });
      const resolvedText = `${originalText}；客户编码：${customer.code}`;
      orderResult = { ...await searchOrderAssistant(actor, resolvedText), resolvedText };
      evidenceRead = true;
      orderGuidance = orderResult.candidates.length
        ? `已读取${orderResult.customer.name}的历史资料，找到 ${orderResult.candidates.length} 份可供核对的参考${orderResult.limited ? "（当前查询有上限）" : ""}。请由你选定具体资料，再预览并明确确认创建生产订单草稿；当前未建单。客户 PO 可空，颜色、数量和交期可在草稿中补齐；基础样口头确认不等于资料批准，草稿不能直接投产。`
        : `已读取${orderResult.customer.name}的历史资料，本次未找到符合要求的已批准参考。请核对款号、款类或返回原资料补齐；没有创建订单，也不能自动新建款式。`;
      // Do not send financial contract text to the model: the permission-checked UI shows it locally.
      return { customer: orderResult.customer, candidates: orderResult.candidates.map(c => ({ id: c.id, styleCode: c.styleCode, styleName: c.styleName, versionNumber: c.versionNumber, orderNo: c.orderNo, materials: c.materials.map(m => ({ code: m.code, name: m.name })) })), instruction: orderGuidance };
    }
    if (module === "finance") {
      return prisma.$transaction(async db => {
        await requireTrade(actor, "trade_view", db);
        const bills = await db.$queryRaw<BillRow[]>(Prisma.sql`${billCte(actor.organizationId)} SELECT * FROM bills WHERE partyKind='customer' AND partyId=${id} AND status='confirmed' AND openMinor<>0 ORDER BY dueDate,id LIMIT 101`);
        const cash = await db.$queryRaw<CashRow[]>(Prisma.sql`${cashCte(actor.organizationId)} SELECT * FROM cash WHERE partyKind='customer' AND partyId=${id} AND status='recorded' AND availableMinor<>0 ORDER BY occurredOn,id LIMIT 101`);
        const drafts = await db.tradeBill.count({ where: { organizationId: actor.organizationId, partyKind: "customer", partyId: id, status: "draft" } });
        const facts = [...bills.slice(0, 100).map(b => ({ kind: "未核销款项", orderNo: b.orderNo, currency: b.currency, openAmount: money(b.openMinor, b.currency), dueDate: b.dueDate, direction: b.direction })), ...cash.slice(0, 100).map(c => ({ kind: "未分配收付记录", currency: c.currency, openAmount: money(c.availableMinor, c.currency), occurredOn: c.occurredOn, direction: c.direction }))];
        tables.push({ title: "已确认款项 · 未核销", columns: ["订单", "款项", "方向", "币种", "未核销金额", "到期日"], rows: bills.slice(0, 100).map(b => ({ href: `/finance/bills/${b.id}`, cells: [b.orderNo, cut(b.title), b.direction === "receivable" ? "应收" : "应付", b.currency, money(b.openMinor, b.currency), b.dueDate] })), notes: [`${drafts} 张草稿未计入欠款。不同币种分别列示，不合计。`, "只列未核销记录，尚未与银行流水或客户对账单比对；不能据此认定错账。", ...(bills.length > 100 ? ["仅显示前 100 条款项，请到财务页继续筛选。"] : [])], emptyMessage: "本次范围内没有未核销的已确认款项；不代表已完成外部对账。" });
        tables.push({ title: "收付登记 · 未分配", columns: ["登记日期", "方向", "币种", "未分配金额"], rows: cash.slice(0, 100).map(c => ({ href: "/finance?tab=cash", cells: [c.occurredOn, c.direction === "receive" ? "收款" : "付款", c.currency, money(c.availableMinor, c.currency)] })), notes: ["财务只读。登记不是银行执行。", ...(cash.length > 100 ? ["仅显示前 100 条收付记录，请到财务页继续筛选。"] : [])], emptyMessage: "本次范围内没有未分配的收付登记。" });
        cards.push({ title: "对账范围", href: "/finance?tab=receivables", facts: [`${drafts} 张草稿未计入欠款`, "以下是未核销/未分配记录，不等于已经确认的错账；未与银行流水或客户对账单自动比对。", "不同币种分别列示；财务数据未写入；登记不是银行执行。", bills.length > 100 || cash.length > 100 ? "仅列前 100 条各类记录，请到财务页继续筛选" : "已列出本次范围内全部未结记录"] });
        for (const b of bills.slice(0, 100)) cards.push({ title: `${b.orderNo} · ${cut(b.title)}`, href: `/finance/bills/${b.id}`, facts: [`${b.direction === "receivable" ? "应收" : "应付"}未核销 ${b.currency} ${money(b.openMinor, b.currency)}`, `到期日：${b.dueDate || "未记录"}`, `原额 ${money(b.amountMinor, b.currency)}；调整 ${money(b.adjustmentMinor, b.currency)}；已核销 ${money(b.allocatedMinor, b.currency)}`] });
        for (const c of cash.slice(0, 100)) cards.push({ title: `未分配${c.direction === "receive" ? "收款" : "付款"}`, href: "/finance?tab=cash", facts: [`${c.currency} ${money(c.availableMinor, c.currency)}`, `登记日期：${c.occurredOn}`] });
        evidenceRead = true;
        return { facts, excludedDraftCount: drafts, limited: bills.length > 100 || cash.length > 100, scope: "未核销/未分配记录，不是外部银行或客户账单差异。无写工具。" };
      });
    }
    if (module === "scheduling") {
      const order = await prisma.salesOrder.findFirstOrThrow({ where: { id, organizationId: actor.organizationId }, include: { lines: { select: { totalQuantity: true } } } });
      const factories = await prisma.party.findMany({ where: { organizationId: actor.organizationId, kind: "factory", archivedAt: null }, orderBy: { code: "asc" }, take: 31 });
      const candidates = [];
      for (const factory of factories.slice(0, 30)) {
        const orders = await prisma.salesOrder.findMany({ where: { organizationId: actor.organizationId, factoryId: factory.id, status: { not: "draft" } }, include: { lines: { select: { totalQuantity: true } }, production: { select: { kind: true, quantity: true } } }, take: 201, orderBy: { createdAt: "desc" } });
        const sample = orders.slice(0, 200), active = sample.filter(o => o.status !== "shipped" && o.status !== "cancelled");
        const quantity = active.reduce((sum, o) => sum + o.lines.reduce((n, l) => n + l.totalQuantity, 0), 0);
        const recorded = (kind: string) => sample.reduce((n, o) => n + o.production.filter(p => p.kind === kind).reduce((s, p) => s + p.quantity, 0), 0);
        candidates.push({ id: factory.id, name: factory.name, currentAssignment: order.factoryId === factory.id, activeOrders: active.length, activeOrderQuantity: quantity, historicalGood: recorded("good"), historicalRework: recorded("rework"), historicalScrapped: recorded("scrapped"), limited: orders.length > 200, capacity: null, onTimeRate: null });
      }
      const transfers = await listFactoryTransfers(actor, { orderId: order.id });
      tables.push({ title: "本单转厂交接", columns: ["原厂 → 新厂", "状态", "交接形态 / 数量", "工序与依据"], rows: transfers.map(r=>({ href: `/orders/${order.id}/transfers`, cells: [`${r.from} → ${r.to}`, r.status === "executed" ? (r.receivedAt ? "已接收，核对投产" : "待新厂接收") : r.status === "rejected" ? "已退回" : "待核对 / 主管确认", r.selections.map(s=>`${s.stage === "cut" ? "裁片" : s.stage === "sewn" ? "车缝半成品" : "未开工"} ${s.colorName}/${s.sizeCode} ${s.quantity}件`).join("；"), `${r.selections[0]?.processNote || "按原任务"}；${r.sourceReference}`] })), emptyMessage: "没有转厂记录。" });
      candidates.sort((a, b) => a.activeOrderQuantity - b.activeOrderQuantity);
      tables.push({ title: `${order.orderNo} · 询厂比较`, columns: ["工厂", "在手单数", "在手件数", "历史合格 / 返工 / 报废（件）", "产能 / 准交率", "核对范围"], rows: candidates.map(c => ({ cells: [`${c.name}${c.currentAssignment ? "（本单当前工厂）" : ""}`, c.activeOrders, c.activeOrderQuantity, `${c.historicalGood} / ${c.historicalRework} / ${c.historicalScrapped}`, "待主管向工厂确认", c.limited ? "仅最近 200 单" : "已有非草稿订单"] })), notes: [`要求交期：${order.requestedDeliveryDate || "待确认"}；本单 ${order.lines.reduce((n, l) => n + l.totalQuantity, 0)} 件。`, "按在手件数由少到多列询厂顺序；件数是订单总量，不是剩余工时或可用产能，不能据此承诺排期。", "本入口不改工厂、交期或投产状态；修改交期需要主管确认。", ...(factories.length > 30 ? ["工厂仅显示前 30 家，比较不完整。"] : [])], emptyMessage: "当前组织没有可查询的工厂记录，暂不能提供询厂比较。" });
      cards.push({ title: `${order.orderNo} 排产核对`, href: `/orders/${order.id}`, facts: [`要求交期：${order.requestedDeliveryDate || "未确认"}`, `本单数量：${order.lines.reduce((n, l) => n + l.totalQuantity, 0)} 件`, "暂无经确认的产能和历史准交率，不能给出可承诺的排产结果；在手量较少仅代表值得优先问询。", "本入口不改工厂、不改交期、不放行；修改交期需要主管确认。", factories.length > 30 ? "工厂仅列前 30 家，请缩小范围" : "工厂范围：当前组织"] });
      for (const c of candidates) cards.push({ title: `${c.name}${c.currentAssignment ? "（本单当前工厂）" : ""}`, facts: [`在手 ${c.activeOrders} 单 / ${c.activeOrderQuantity} 件（订单总量，并非剩余工时）`, `历史登记合格 ${c.historicalGood}、返工 ${c.historicalRework}、报废 ${c.historicalScrapped} 件`, "产能、可接单日期、品类适配：待主管向工厂确认", c.limited ? "仅查看该厂最近 200 单，比较可能不完整" : "已核对已有非草稿订单"] });
      evidenceRead = true;
      return { order: { orderNo: order.orderNo, deliveryDate: order.requestedDeliveryDate }, candidates, transfers, recommendation: "只能给出询厂顺序，不可把在手件数当可用产能，不可编造历史准交率。没有可承诺排期。修改交期需主管确认，本入口无修改工具。" };
    }
    const style = await prisma.style.findFirstOrThrow({ where: { id, organizationId: actor.organizationId }, include: { yearOption: true, versions: { orderBy: { versionNumber: "desc" }, take: 21, include: { bomLines: { include: { material: { select: { name: true, code: true, organizationId: true } } } } } } } });
    const versionIds = style.versions.map(v => v.id);
    const audits = await prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, OR: [{ entityType: "Style", entityId: style.id }, { entityType: "StyleVersion", entityId: { in: versionIds } }] }, orderBy: { createdAt: "desc" }, take: 31, select: { action: true, summary: true, createdAt: true, actor: { select: { name: true } } } });
    const versions = style.versions.slice(0, 20).map(v => ({ id: v.id, number: v.versionNumber, status: v.status, approvedAt: v.approvedAt?.toISOString() ?? null, approvedBy: v.approvedByName, construction: constructionPublic(readConstruction(v.constructionJson).filter(r => r.group === "process" || v.bomLines.some(b => b.materialId === r.materialId && b.material.organizationId === actor.organizationId))).map(r => ({ ...r, fields: Object.fromEntries(Object.entries(r.fields).map(([k,value]) => [k, cut(value || "")])) })), spec: cut(v.specNotes), process: cut(v.processNotes), pattern: cut(v.patternRevision), change: cut(v.changeSummary), materials: v.bomLines.filter(b => b.material.organizationId === actor.organizationId).map(b => `${b.material.code} ${b.material.name}`).slice(0, 20) }));
    tables.push({ title: `${style.code} ${style.name} · 资料版次`, columns: ["版次", "资料状态", "规格 / 版型", "面辅料", "工艺 / 变更", "批准人 / 时间"], rows: versions.map(v => ({ href: `/styles/${style.id}`, cells: [`V${v.number}`, v.status === "approved" ? "资料已批准" : v.status === "rejected" ? "资料未通过" : "资料待确认", `${v.spec}\n版次说明：${v.pattern}`, v.materials.join("、") || null, `${v.process}\n变更：${v.change}`, `${v.approvedBy || "无批准人记录"}\n${v.approvedAt || "无批准时间记录"}`] })), notes: ["资料批准不能替代客户基础样审版。独立基础样审版结论档案尚未建立。", "修订应挂原版次，保留同一款式；采用资料仍须重新确认。", "较长说明最多显示 900 字，面辅料最多显示 20 项；完整记录请点版次查看。", ...(style.versions.length > 20 ? ["仅显示最近 20 版。"] : [])], emptyMessage: "该款尚无资料版次，不能认定已审版。" });
    for (const v of versions.filter(v => v.construction.length)) tables.push({ title: `${style.code} · V${v.number} 用料与特殊工艺`, columns: ["类别", "项目", "参数与要求", "图片"], rows: v.construction.map(r => ({ href: `/styles/${style.id}#style-materials`, cells: [CONSTRUCTION_LABELS[r.group], r.name, Object.entries(r.fields).filter(([, value]) => value).map(([key, value]) => `${CONSTRUCTION_FIELDS[key as keyof typeof CONSTRUCTION_FIELDS]}：${value}`).join("；"), r.imageId ? "已配图，打开资料查看" : "未配图"] })), notes: ["本版填写资料，不代表所有订单最终用料；单耗未填需核对。图片尚未做自动识别。"], emptyMessage: "尚未填写用料与特殊工艺。" });
    tables.push({ title: `${style.code} · 操作历史`, columns: ["时间", "操作者", "改了什么"], rows: audits.slice(0, 30).map(a => ({ cells: [a.createdAt.toISOString(), a.actor?.name || "系统/历史账号", cut(a.summary)] })), notes: audits.length > 30 ? ["仅显示最近 30 条历史。"] : [], emptyMessage: "本次范围内未找到操作历史；不能据此推断已批准。" });
    cards.push({ title: `${style.code} ${style.name}`, href: `/styles/${style.id}`, facts: [`开发年份：${style.yearOption?.name || "未记录"}`, "资料匹配基于文字和结构，不是视觉识款。", "资料版本批准与客户基础样审版须分别核对；当前未建立独立的基础样审版结论档案。", "本入口只查询。驳回后修订应挂原版次并保留同一款式；不在此新建款式。", style.versions.length > 20 || audits.length > 30 ? "版次或历史较多，仅列最近 20 版 / 30 条历史" : "已查已有版次和审计历史"] });
    for (const v of versions) cards.push({ title: `V${v.number} · ${v.status === "approved" ? "资料已批准" : v.status === "rejected" ? "资料未通过" : "资料待确认"}`, href: `/styles/${style.id}`, facts: [`批准：${v.approvedBy || "无批准人记录"} / ${v.approvedAt || "无批准时间记录"}`, `规格：${v.spec}`, `工艺：${v.process}`, `面辅料：${v.materials.join("、") || "未记录"}`, `版次说明：${v.pattern}；变更：${v.change}`] });
    for (const a of audits.slice(0, 30)) cards.push({ title: "操作历史", facts: [`${a.createdAt.toISOString()} · ${a.actor?.name || "系统/历史账号"}`, cut(a.summary)] });
    evidenceRead = true;
    return { style: { code: style.code, name: style.name, year: style.yearOption?.name ?? null }, versions, history: audits.slice(0, 30).map(a => ({ when: a.createdAt.toISOString(), who: a.actor?.name, what: cut(a.summary) })), caveat: "只能证实资料批准，不得等同客户基础样已审过。推荐需列具体匹配项及差异。" };
  });
  if (module === "finance") {
    const expenses = stageExpenseTools(actor);
    return { tools: [lookup, detail, ...expenses.tools], get cards() { return [...cards, ...expenses.cards]; }, get tables() { return [...tables, ...expenses.tables]; }, getOrderResult: () => orderResult, hasEvidence: () => evidenceRead || expenses.hasEvidence() };
  }
  return { tools: [lookup, detail], cards, tables, getOrderResult: () => orderResult, hasEvidence: () => evidenceRead,
    ...(module === "order" ? {
      incompleteEvidence: () => selected.size === 1 && !evidenceRead ? "你只查到了唯一客户，尚未读取历史资料。必须用本轮find_records返回的客户id调用read_evidence；不要把缺少PO、数量或交期当作查询或创建草稿的阻碍。" : null,
      getOrderGuidance: () => orderGuidance,
    } : {}),
  };
}
