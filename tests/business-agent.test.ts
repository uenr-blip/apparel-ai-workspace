import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { resetDatabase } from "./helpers";
import { businessTools } from "@/server/agents/business-tools";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { runToolLoop, liveCompletion, type Completion } from "@/server/agents/runtime";
import { confirmOrderAssistant, previewOrderAssistant } from "@/server/services/order-assistant";
const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const sales = { ...manager, userId: IDS.userSales, role: "salesperson" };
function scripted(query: string): Completion {
  let step = 0;
  return async messages => {
    step++;
    if (step === 1) return { content: null, tool_calls: [{ id: "find", type: "function", function: { name: "find_records", arguments: JSON.stringify({ query }) } }] };
    if (step === 2) {
      const response = JSON.parse(messages.at(-1)!.content!);
      return { content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_evidence", arguments: JSON.stringify({ id: response.candidates[0].id }) } }] };
    }
    return { content: "已按工具返回的业务记录列示，未写入。" };
  };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("智能体业务工具：真实数据库、协议模拟", () => {
  beforeEach(resetDatabase);
  it("建单两步取证接人工预览/确认，重复提交一单且完整审计", async () => {
    const text = "给北岸服饰建一个针织T恤订单，基础样已确认";
    const result = await runBusinessAgent(sales, "order", text, scripted("北岸服饰"));
    expect(result.steps).toHaveLength(2);
    expect(result.evidenceRead).toBe(true);
    const data = result.orderResult!;
    const p = await previewOrderAssistant(sales, { text: data.resolvedText, candidateId: data.candidates[0].id, idempotencyKey: "agent-confirm-flow" });
    const created = await confirmOrderAssistant(sales, { proposalId: p.proposalId, confirmed: true });
    expect(await confirmOrderAssistant(sales, { proposalId: p.proposalId, confirmed: true })).toEqual(created);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: created.orderId, action: "order.assistant_draft_created" } });
    expect(audit.actorUserId).toBe(sales.userId); expect(audit.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(audit.payloadJson!).after.status).toBe("draft");
  });
  it("客户唯一后模型提前结束须继续取证；建单说明采用服务端事实，不沿用模型错误门槛", async () => {
    const count = await prisma.salesOrder.count();
    let step = 0;
    const result = await runBusinessAgent(sales, "order", "给北岸服饰建一个针织T恤订单", async messages => {
      if (++step === 1) return { content: null, tool_calls: [{ id: "find", type: "function", function: { name: "find_records", arguments: '{"query":"北岸服饰"}' } }] };
      if (step === 2) return { content: "必须提供PO、件数和交期才能创建销售样跟单。" };
      if (step === 3) {
        expect(messages.at(-1)?.content).toContain("必须用本轮find_records返回的客户id调用read_evidence");
        const lookup = JSON.parse(messages.find(m => m.role === "tool")!.content!);
        return { content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_evidence", arguments: JSON.stringify({ id: lookup.candidates[0].id }) } }] };
      }
      return { content: "已帮你创建销售样跟单并批准投产。" };
    });
    expect(step).toBe(4);
    expect(result.evidenceRead).toBe(true);
    expect(result.answer).toContain("客户 PO 可空");
    expect(result.answer).toContain("由你选定具体资料");
    expect(result.answer).toContain("生产订单草稿");
    expect(result.answer).toContain("当前未建单");
    expect(result.answer).not.toContain("销售样跟单");
    expect(result.answer).not.toContain("已帮你");
    expect(await prisma.salesOrder.count()).toBe(count);
    const audit = await prisma.auditEvent.findUniqueOrThrow({ where: { id: result.runId } });
    const payload = JSON.parse(audit.payloadJson!);
    expect(payload.resultHash).not.toBe(payload.modelAnswerHash);
  });
  it("持续拒绝取证不能返回成功；重新查客户清除旧参考，歧义或空结果只提示核对客户", async () => {
    let step = 0;
    await expect(runBusinessAgent(sales, "order", "给北岸服饰建针织订单", async () => ++step === 1
      ? { content: null, tool_calls: [{ id: "find", type: "function", function: { name: "find_records", arguments: '{"query":"北岸服饰"}' } }] }
      : { content: "已经查完，直接建单" })).rejects.toThrow(/限定步骤/);
    expect(step).toBe(4);
    expect(await prisma.auditEvent.count({ where: { action: "agent.query_completed" } })).toBe(0);
    const registry = businessTools(sales, "order", "给北岸服饰建针织订单");
    const found = await registry.tools[0].run({ query: "北岸服饰" }) as { candidates: { id: string }[] };
    await registry.tools[1].run({ id: found.candidates[0].id });
    expect(registry.getOrderResult()).not.toBeNull();
    await registry.tools[0].run({ query: "不存在" });
    expect(registry.getOrderResult()).toBeNull();
    expect(registry.hasEvidence()).toBe(false);
    expect(registry.incompleteEvidence?.()).toBeNull();
    expect(registry.getOrderGuidance?.()).toContain("没有找到匹配客户");
    await expect(registry.tools[1].run({ id: found.candidates[0].id })).rejects.toThrow(/先查询/);
    await prisma.customer.create({ data: { id: "ambiguous-order", organizationId: IDS.orgDemo, code: "OTHER", name: "北岸服饰二部", demoNote: "隔离测试" } });
    await registry.tools[0].run({ query: "北岸服饰" });
    expect(registry.getOrderGuidance?.()).toContain("多个客户");
    expect(registry.incompleteEvidence?.()).toBeNull();
    await expect(registry.tools[1].run({ id: found.candidates[0].id })).rejects.toThrow(/先查询/);
  });
  it("找版型和审版返回实际批准凭据，不新增款式或版次", async () => {
    const before = await prisma.styleVersion.findMany({ orderBy: { id: "asc" } });
    for (const entry of ["development", "review"] as const) {
      const run = await runBusinessAgent(manager, entry, "ST-26018 这个版审过了吗", scripted("ST-26018"));
      expect(run.evidenceRead).toBe(true);
      expect(run.cards.some(c => c.title.includes("资料已批准"))).toBe(true);
      expect(run.cards.flatMap(c => c.facts).join()).toContain("基础样");
      const table = run.tables.find(t => t.title.endsWith("资料版次"))!;
      expect(table.rows.some(r => r.cells[1] === "资料已批准")).toBe(true);
      expect(table.notes?.join()).toContain("不能替代客户基础样审版");
      const receipt = await prisma.auditEvent.findUniqueOrThrow({ where: { id: run.runId } });
      expect(JSON.parse(receipt.payloadJson!).tablesHash).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(await prisma.styleVersion.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  it("排产显示真实在手量和缺失产能，调交期请求没有写工具", async () => {
    const before = await prisma.salesOrder.findMany({ orderBy: { id: "asc" } });
    const run = await runBusinessAgent(manager, "scheduling", "DEMO-ORD-001 排给谁，改交期", scripted("DEMO-ORD-001"));
    expect(run.cards.flatMap(c => c.facts).join()).toContain("修改交期需要主管确认");
    expect(run.cards.flatMap(c => c.facts).join()).toContain("暂无经确认的产能");
    const comparison = run.tables.find(t => t.title.endsWith("询厂比较"))!;
    expect(comparison.rows.length).toBeGreaterThan(0);
    expect(comparison.rows.every(r => r.cells[4] === "待主管向工厂确认")).toBe(true);
    expect(comparison.notes?.join()).toContain("不是剩余工时或可用产能");
    expect(await prisma.salesOrder.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
  it("财务只读、排除草稿，隐藏银行字段，未授权及伪造组织角色都拒绝", async () => {
    const snapshot = async () => Promise.all([prisma.tradeBill.findMany({ orderBy: { id: "asc" } }), prisma.tradeCash.findMany({ orderBy: { id: "asc" } }), prisma.tradeAllocation.findMany({ orderBy: { id: "asc" } })]);
    const order = await prisma.salesOrder.findFirstOrThrow({ where: { organizationId: IDS.orgDemo, orderNo: "DEMO-ORD-001" } });
    await prisma.tradeBill.createMany({ data: [
      { id: "agent-jpy", organizationId: IDS.orgDemo, orderId: order.id, direction: "receivable", partyKind: "customer", partyId: order.customerId, title: "JPY", category: "other", currency: "JPY", amountMinor: BigInt(123), dueDate: "2026-09-25", basis: "test", status: "confirmed", createdBy: manager.userId, createdAt: "2026-09-24" },
      { id: "agent-kwd", organizationId: IDS.orgDemo, orderId: order.id, direction: "receivable", partyKind: "customer", partyId: order.customerId, title: "KWD", category: "other", currency: "KWD", amountMinor: BigInt(1234), dueDate: "2026-09-25", basis: "test", status: "confirmed", createdBy: manager.userId, createdAt: "2026-09-24" },
      { id: "agent-draft", organizationId: IDS.orgDemo, orderId: order.id, direction: "receivable", partyKind: "customer", partyId: order.customerId, title: "DRAFT-EXCLUDED", category: "other", currency: "CNY", amountMinor: BigInt(99999), dueDate: "2026-09-25", basis: "test", status: "draft", createdBy: manager.userId, createdAt: "2026-09-24" },
    ] });
    const before = await snapshot();
    const run = await runBusinessAgent(manager, "finance", "北岸服饰哪些没对上", scripted("北岸服饰"));
    expect(run.cards.flatMap(c => c.facts).join()).toContain("草稿未计入欠款");
    expect(JSON.stringify(run)).not.toMatch(/bankAccount|bankReference|DRAFT-EXCLUDED/);
    expect(run.cards.flatMap(c => c.facts).join()).toContain("JPY 123");
    expect(run.cards.flatMap(c => c.facts).join()).toContain("KWD 1.234");
    const openBills = run.tables.find(t => t.title === "已确认款项 · 未核销")!;
    expect(openBills.rows.find(r => r.cells[3] === "JPY")?.cells[4]).toBe("123");
    expect(openBills.rows.find(r => r.cells[3] === "KWD")?.cells[4]).toBe("1.234");
    expect(JSON.stringify(run.tables)).not.toContain("DRAFT-EXCLUDED");
    expect(openBills.notes?.join()).toContain("草稿未计入欠款");
    expect(await snapshot()).toEqual(before);
    await expect(runBusinessAgent(sales, "finance", "北岸服饰", scripted("北岸服饰"))).rejects.toThrow(/无权/);
    await expect(runBusinessAgent({ ...sales, role: "manager" }, "review", "ST-26018", scripted("ST-26018"))).rejects.toThrow(/无权/);
    await expect(runBusinessAgent({ ...manager, organizationId: IDS.orgIso }, "review", "ST-26018", scripted("ST-26018"))).rejects.toThrow(/无权/);
  });
  it("不能跳过对象查询猜 ID；查询有歧义不能读客户详情", async () => {
    const registry = businessTools(manager, "finance", "哪个客户");
    await expect(registry.tools[1].run({ id: "guessed" })).rejects.toThrow(/先查询/);
    await prisma.customer.create({ data: { id: "similar-customer", organizationId: IDS.orgDemo, code: "OTHER", name: "北岸服饰二部", demoNote: "test" } });
    const found = await registry.tools[0].run({ query: "北岸服饰" }) as { candidates: { id: string }[]; requiresClarification: boolean };
    expect(found.requiresClarification).toBe(true);
    expect(registry.tables[0].rows.every(r => r.cells[2] === "待补充完整名称或编码")).toBe(true);
    await expect(registry.tools[1].run({ id: found.candidates[0].id })).rejects.toThrow(/先查询/);
    await registry.tools[0].run({ query: "不存在的客户" });
    expect(registry.tables.at(-1)?.rows).toEqual([]);
    expect(registry.tables.at(-1)?.emptyMessage).toContain("尚未查询账目");
  });
});
describe("模型协议边界", () => {
  it("缺密钥失败，不联网，不退回假成功", async () => {
    vi.stubEnv("AGENT_MODE", "live"); vi.stubEnv("AGENT_API_KEY", "");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(liveCompletion([], [])).rejects.toThrow(/AGENT_API_KEY/);
    expect(network).not.toHaveBeenCalled();
  });
  it("写工具和伪造工具被拒绝，没有业务工具调用不能宣称查过", async () => {
    const run = vi.fn(); const tools = [{ name: "read", description: "只读", parameters: {}, run }];
    await expect(runToolLoop({ text: "修改账", instructions: "只读", tools, completion: async () => ({ content: null, tool_calls: [{ id: "bad", type: "function", function: { name: "write_sql", arguments: "{}" } }] }) })).rejects.toThrow(/未授权工具/);
    expect(run).not.toHaveBeenCalled();
    await expect(runToolLoop({ text: "查客户", instructions: "", tools, completion: async () => ({ content: "都查过了" }) })).rejects.toThrow(/没有查询业务依据/);
  });
  it("兼容接口发送真实工具定义和回传结果；HTTP 错误不泄漏返回体", async () => {
    vi.stubEnv("AGENT_MODE", "live"); vi.stubEnv("AGENT_API_KEY", "test-secret-not-a-real-key");
    const network = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok", tool_calls: null } }] }), { status: 200 })); vi.stubGlobal("fetch", network);
    await liveCompletion([{ role: "tool", tool_call_id: "one", content: "verified" }], [{ name: "lookup", description: "查询", parameters: { type: "object" }, run: async () => ({}) }]);
    const body = JSON.parse(network.mock.calls[0][1].body);
    expect(body.tools[0].function.name).toBe("lookup"); expect(body.messages[0].tool_call_id).toBe("one");
    network.mockResolvedValue(new Response("provider secret content", { status: 401 }));
    await expect(liveCompletion([], [])).rejects.toThrow(/鉴权失败/);
  });
});
