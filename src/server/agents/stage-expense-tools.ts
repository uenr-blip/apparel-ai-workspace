import { z } from "zod";
import { prisma } from "@/lib/db";
import { StageTarget } from "@/lib/workflow-stage";
import { requireTrade } from "@/server/services/trade-db";
import type { TradeActor } from "@/server/services/trade-contract";
import type { BusinessToolRegistry } from "./business-tools";
import { workflowTools } from "./workflow-tools";

/** Expense lookup includes unsaved/archived stages; material handoffs are not a prerequisite. */
export function stageExpenseTools(actor: TradeActor): BusinessToolRegistry {
  const shared = workflowTools(actor), candidates: BusinessToolRegistry["tables"] = [];
  const expense = shared.tools.find(tool => tool.name === "read_stage_expenses")!;
  const selected = new Set<string>();
  const targetKey = (target: { projectId?: string; followRowId?: string }) => `${target.projectId ?? ""}:${target.followRowId ?? ""}`;
  return { cards: shared.cards, get tables() { return [...candidates, ...shared.tables]; }, hasEvidence: shared.hasEvidence, getOrderResult: () => null, tools: [{
    name: "find_stage_expense_subjects",
    description: "按开发编号、款号或名称定位费用所属开发/销售样/大货；包括未保存用料和已归档资料。多个候选须补充唯一编号和阶段，不能猜归属。",
    parameters: { type: "object", properties: { query: { type: "string" }, stage: { type: "string", enum: ["all", "development", "sales_sample", "bulk"] } }, required: ["query"], additionalProperties: false },
    run: async raw => {
      await requireTrade(actor);
      const { query, stage } = z.object({ query: z.string().trim().min(1).max(100), stage: z.enum(["all", "development", "sales_sample", "bulk"]).default("all") }).strict().parse(raw);
      selected.clear();
      const [projects, rows] = await Promise.all([
        stage === "all" || stage === "development" ? prisma.developmentProject.findMany({ where: { organizationId: actor.organizationId, OR: [{ code: { contains: query } }, { name: { contains: query } }, { style: { code: { contains: query } } }] }, select: { id: true, code: true, name: true, archivedAt: true }, orderBy: { code: "asc" }, take: 21 }) : [],
        stage !== "development" ? prisma.orderMerchStyle.findMany({ where: { sheet: { organizationId: actor.organizationId, kind: stage === "all" ? { in: ["sales_sample", "bulk"] } : stage }, OR: [{ styleCode: { contains: query } }, { styleName: { contains: query } }, { sheet: { title: { contains: query } } }] }, select: { id: true, sheetId: true, styleCode: true, styleName: true, sheet: { select: { kind: true, title: true, archivedAt: true } } }, orderBy: { id: "asc" }, take: 21 }) : [],
      ]);
      const found = [
        ...projects.map(p => ({ projectId: p.id, label: `开发 · ${p.code} ${p.name}`, href: `/projects/${p.id}#stage-expenses`, archived: Boolean(p.archivedAt) })),
        ...rows.map(r => ({ followRowId: r.id, label: `${r.sheet.kind === "sales_sample" ? "销售样" : "大货"} · ${r.styleCode} ${r.styleName} · ${r.sheet.title}`, href: `/orders/follow/${r.sheetId}?rowId=${encodeURIComponent(r.id)}#stage-expenses`, archived: Boolean(r.sheet.archivedAt) })),
      ];
      if (found.length === 1) selected.add(targetKey(found[0]));
      const limited = found.length > 20;
      candidates.push({ title: "阶段费用所属资料", columns: ["所属阶段与款式", "状态"], rows: found.slice(0, 20).map(r => ({ href: r.href, cells: [r.label, r.archived ? "已归档，历史可查" : "已有资料"] })), notes: ["多条候选需补充唯一编号或阶段后再查金额。", ...(limited ? ["仅显示前 20 条候选，请缩小范围。"] : [])], emptyMessage: "未找到对应资料，请补充开发编号、款号或跟单名称；不能据此认定未发生费用。" });
      return { candidates: found.slice(0, 20), requiresClarification: found.length !== 1, limited };
    },
  }, {
    ...expense,
    run: async raw => {
      await requireTrade(actor);
      const target = StageTarget.parse(raw);
      if (!selected.has(targetKey(target))) throw new Error("请先定位唯一的费用所属资料，不能猜测开发或款行编号");
      return expense.run(target);
    },
  }] };
}
