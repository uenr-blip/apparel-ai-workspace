import { signFollowTicket } from "./follow-ticket";
import { resolveContext } from "@/server/context/context-service";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { z } from "zod";
import { agentStatus, agentConfig, type AgentProfile } from "@/lib/agent-config";
import type { TradeActor } from "@/server/services/trade-contract";
import { authorizeAgent, businessTools, type AgentModule } from "./business-tools";
import { runToolLoop, completionFor, type Completion } from "./runtime";
import { currentWeekRange } from "@/lib/agent-delivery-range";
import { AGENT_RESULT_VERSION } from "@/lib/agent-table";
const active = new Set<string>();
export async function runBusinessAgent(actor: TradeActor, module: AgentModule, raw: string, completion?: Completion, profile: AgentProfile = "default") {
  const text = z.string().trim().min(2).max(1000).parse(raw);
  await authorizeAgent(actor, module);
  const key = `${actor.organizationId}:${actor.userId}`;
  if (active.has(key)) throw new Error("上一条查询还在处理，请稍后再试");
  active.add(key);
  try {
    const context = await resolveContext(actor, module === "product" ? ["development", "review"] : module === "production" ? ["scheduling", "workspace"] : module);
    const registry = businessTools(actor, module, text);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const week = currentWeekRange("本周");
    const workflow = module === "product" ? "根据用户意图自行选工具：找相似款调用 styles_find_records / styles_read_evidence；问资料批准用 review_find_records / review_read_evidence；查开发版单/多厂打样先 pattern_find_projects 唯一查对象再 pattern_read_board。部分引用要先查目标及 pattern_find_sources 查来源，用户说清采用字段后 pattern_prepare_reference。不要把正式款式ID当开发ID。没有留档版单不能猜成分支数。均不直接改业务，由人修改、预览、确认采用。"
      : module === "production" ? "询问排给谁时调用 schedule_find_records / schedule_read_evidence；询问交期风险时调用 progress_list_due_orders / progress_read_order_risks。自行规划并按工具名前缀匹配取证，不让用户先选助手。"
      : module === "follow" ? "查询 PO、产品编号、采购日期、颜色或出运时，调用 read_follow_records 读真实跟单；日期范围按客户采购日期，可只传关键词，勿编造缺项。建表时先 read_follow_setup 核对原话中的工厂和跟单规则。明确销售样或大货后才 prepare_follow_header；没说类型、有混合类型、多家工厂时先追问，不能默认。仅形成表头建议，无写入；客户不等于工厂，季节没说可空，款式数量不会自动写入。"
      : module === "workspace" ? "按问题自主选工具：问客户、工厂、供应商的现况或历史，先 find_partner 用名称/编号唯一查明，再 read_partner 按 active/draft/history/all 查询并可翻页。问近期交期风险，先 list_due_orders 按交期范围，再 read_order_risks 核对；交期查询未说范围用今天起7天。不要把伙伴历史查询强制限为未来7天。"
      : module === "finance" ? "问客户未结款项时先 find_records 唯一查客户，再 read_evidence。问开发、销售样或大货阶段费用时，先 find_stage_expense_subjects 按编号/款号/名称和阶段定位唯一所属，再用其 projectId 或 followRowId 调 read_stage_expenses；多候选先请用户明确，不能按同款猜归属。未保存用料也可能有费用，不能用是否存在交接记录判断有无费用。只读，不执行分摊、确认应付或付款。"
      : module === "order" ? "这是生产订单草稿的历史参考查询，不能改称销售样跟单或大货跟单。find_records只查客户名称/编码，不查款式。客户唯一后必须read_evidence，即使PO、颜色数量或交期缺失也要读取参考；这些可在草稿补齐。返回多份历史参考由用户选定，模型不得代选，不以基础样口头确认替代资料批准。" : "先 find_records 查对象，再 read_evidence 查详细依据。";
    const output = await runToolLoop({ text, incompleteEvidence: registry.incompleteEvidence, maxRounds: module === "product" || module === "production" ? 6 : 4, completion: completion ?? completionFor(agentConfig(profile)), tools: registry.tools, instructions: `${context.instructions}
当前入口 ${module}；上海日期 ${today}，本周为 ${week!.from} 至 ${week!.to}（周一至周日），不是今天起7天。去年指上一个自然年。${workflow}若没有唯一对象（开发资料匹配除外）只能请用户补充，不猜 ID。开发查找先提取款名特征关键词，年份按记录核对，不得用导入日期冒充开发年份。调交期请求只能解释需主管确认，不能执行。
界面会直接把工具的业务记录列成表格，不需要重复抄写表格、数字或长篇分析。最后用一到三句说明关键建议、缺项或需要用户补充的问题；推荐时仍说明匹配依据及差异。` });
    // Delivery conclusions come from authorized records, not unsupported model prose.
    const conclusions = registry.tables.filter(table => table.conclusion);
    const answer = registry.getOrderGuidance?.() ?? (conclusions.length ? conclusions.map(table => `${table.title}\n${table.conclusion!.title}。${table.conclusion!.detail}\n下一步：${table.conclusion!.nextStep}`).join("\n\n") : output.answer);
    const runId = createId();
    await prisma.auditEvent.create({ data: { id: runId, organizationId: actor.organizationId, actorUserId: actor.userId, actorType: "user", action: "agent.query_completed", entityType: "AgentRun", entityId: runId, summary: `${module}助手完成${output.trace.length}步只读查询`, payloadJson: JSON.stringify({ context: context.manifest, module, model: completion ? "test-transport" : agentConfig(profile).model, questionHash: sha256(text), resultHash: sha256(answer), modelAnswerHash: sha256(output.answer), tablesHash: sha256(JSON.stringify(registry.tables)), tools: output.trace.map(t => ({ name: t.tool, evidenceHash: sha256(JSON.stringify(t.result)) })) }) } });
    const followDraft = registry.getFollowDraft?.() ?? null;
    const followTicket = followDraft ? await signFollowTicket(actor, followDraft, context.manifest, text, completion ? "test-transport" : agentConfig(profile).model) : null;
    return { resultVersion: AGENT_RESULT_VERSION, patternSuggestion: registry.getPatternSuggestion?.() ?? null, followDraft, followTicket, runId, context: context.manifest, answer, steps: output.trace.map(t => t.label), cards: registry.cards, tables: registry.tables, evidenceRead: registry.hasEvidence(), status: completion ? { mode: "mock", model: "test-transport", ready: false, label: "本地协议验证，未调用真实模型" } : { ...agentStatus(profile), label: `${agentStatus(profile).model} · 本次模型调用已完成` }, orderResult: registry.getOrderResult() };
  } finally { active.delete(key); }
}
