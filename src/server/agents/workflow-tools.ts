import { getStageExpenses } from "@/server/services/stage-expenses";
import { StageTarget } from "@/lib/workflow-stage";
import { constructionReferences } from "@/lib/construction-reference";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { STAGE_LABELS } from "@/lib/workflow-stage";
import { constructionPublic, readConstruction } from "@/lib/style-construction";
import { authorizeStage, getStageTransferHistory } from "@/server/services/workflow-stage";
import type { TradeActor } from "@/server/services/trade-contract";
import type { BusinessToolRegistry } from "./business-tools";
import { WORKFLOW_CONTEXT_RULES } from "@/server/context/platform";

export function workflowTools(actor: TradeActor): BusinessToolRegistry {
  const cards: BusinessToolRegistry["cards"] = [], tables: BusinessToolRegistry["tables"] = [];
  let read = false;
  return { cards, tables, hasEvidence: () => read, getOrderResult: () => null, tools: [{
    name: "read_stage_handoffs", description: "按款号、开发编号、跟单名查询开发到销售样到大货的固定资料、交接和待接手路径。只读，不把查阅当审批。",
    parameters: { type: "object", properties: { query: { type: "string", description: "款号、开发编号或跟单名称关键词" } }, required: ["query"], additionalProperties: false },
    run: async raw => {
      await authorizeStage(actor); const { query } = z.object({ query: z.string().trim().min(1).max(100) }).strict().parse(raw);
      const [projects, followRows] = await Promise.all([
        prisma.developmentProject.findMany({ where: { organizationId: actor.organizationId, OR: [{ code: { contains: query } }, { name: { contains: query } }, { style: { code: { contains: query } } }] }, select: { id: true, code: true, name: true }, take: 31 }),
        prisma.orderMerchStyle.findMany({ where: { sheet: { organizationId: actor.organizationId }, OR: [{ styleCode: { contains: query } }, { styleName: { contains: query } }, { sheet: { title: { contains: query } } }] }, select: { id: true, sheetId: true, styleCode: true, sort: true }, take: 31 }),
      ]);
      const stages = await prisma.workflowStage.findMany({ where: { organizationId: actor.organizationId, OR: [{ projectId: { in: projects.map(p => p.id) } }, { followRowId: { in: followRows.map(r => r.id) } }] }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } }, take: 31 });
      const result = await Promise.all(stages.slice(0, 30).map(async s => {
        const p = projects.find(p => p.id === s.projectId), row = followRows.find(r => r.id === s.followRowId), v = s.revisions[0];
        const transfers = await getStageTransferHistory(actor, s.id);
        const owner = await prisma.user.findFirst({ where: { id: s.ownerId, organizationId: actor.organizationId }, select: { name: true } });
        return { stageId: s.id, projectId: s.projectId, followRowId: s.followRowId, kind: STAGE_LABELS[s.kind], label: p?.code ?? row?.styleCode ?? "业务记录", href: p ? `/projects/${p.id}#stage-materials` : `/orders/follow/${row!.sheetId}?rowId=${row!.id}#stage-materials`, owner: owner?.name ?? "待核对", revision: v?.number ?? null, reason: v?.reason ?? "尚未保存", materials: constructionPublic(readConstruction(v?.constructionJson)), inheritedReferences: constructionReferences(v?.sourceSnapshotJson), transfers };
      }));
      tables.push({ title: "阶段资料与交接", columns: ["款式 / 阶段", "负责人", "用料记录", "来源与去向"], rows: result.map(r => ({ href: r.href, cells: [`${r.label} / ${r.kind}`, r.owner, r.revision ? `第 ${r.revision} 次 · ${r.materials.length} 项 · ${r.reason}` : "尚未保存", r.transfers.map(t => `${t.outgoing ? "交接到" : "来自"}${t.kind} · ${t.batchKey} · ${t.versionLabel}`).join("；") || "尚无交接记录"] })), emptyMessage: "未找到已保存的阶段资料；不能认定流程已完成，请打开对应版单或跟单核对。", notes: [WORKFLOW_CONTEXT_RULES, ...(stages.length > 30 || projects.length > 30 || followRows.length > 30 ? ["仅列前 30 条候选，请缩小范围。"] : [])] });
      read = true; return { records: result, rules: WORKFLOW_CONTEXT_RULES, limited: stages.length > 30 || projects.length > 30 || followRows.length > 30 };
    },
  }, {
    name: "read_stage_expenses", description: "按已确认的开发ID或跟单款行ID查本阶段及明确交接来源的费用、原凭据入口和核销状态。须财务查阅权限；不按同款猜归属，不执行分摊或付款。",
    parameters: { type: "object", properties: { projectId: { type: "string" }, followRowId: { type: "string" } }, additionalProperties: false },
    run: async raw => {
      const data = await getStageExpenses(actor, StageTarget.parse(raw));
      tables.push({ title: `${data.subject.label} · 阶段费用`, columns: ["发生阶段", "费用", "往来方", "币种", "金额", "已核销", "状态"], rows: data.rows.map(r => ({ href: `/finance/bills/${r.id}`, cells: [r.orderNo, r.title, r.partyName, r.currency, r.amount, r.allocatedAmount, r.status === "draft" ? "草稿，不计欠款" : r.status === "void" ? "已作废" : r.settled ? "已核销" : "已确认待核销"] })), emptyMessage: "本阶段及明确交接来源尚未登记费用；不能据此认定未发生费用。", notes: ["交接来源费用仅供回查，未复制或分摊到本阶段；不同币种分开核对。", "费用保留发生阶段，分摊由财务逐笔决定。记录不是银行支付或税务申报。"] });
      read = true;
      return { subject: data.subject.label, records: data.rows, rules: WORKFLOW_CONTEXT_RULES };
    },
  }] };
}
