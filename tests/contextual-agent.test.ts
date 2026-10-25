import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { businessTools } from "@/server/agents/business-tools";
import { runBusinessAgent } from "@/server/agents/business-agent";
import type { Completion } from "@/server/agents/runtime";
import { draftContext, publishContext } from "@/server/context/context-service";
import { createFollowSheet } from "@/server/services/order-merch";
import { resetDatabase } from "./helpers";

const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const sales = { ...manager, userId: IDS.userSales, role: "salesperson" };
const suggestion = { kind: "bulk" as const, title: "SS27 大货跟单", seasonCode: "SS27", factoryName: "云杉服装工厂" };
const call = (name: string, args: object) => ({ content: null, tool_calls: [{ id: name, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }] });
function followCompletion(): Completion {
  let step = 0;
  return async () => {
    step += 1;
    if (step === 1) return call("read_follow_setup", { factoryQuery: "云杉" });
    if (step === 2) return call("prepare_follow_header", suggestion);
    return { content: "已准备表头，请核对或修改，再确认建表。" };
  };
}
async function followPreview() {
  return runBusinessAgent(sales, "follow", "建一张 SS27 大货跟单，云杉服装工厂", followCompletion());
}
async function publish(scope: "company" | "follow" | "development" | "review") {
  const draft = await draftContext(manager, { scope, title: `${scope}试用说明`, text: `本次${scope}规则须逐单核对，尚未经一线验收。`, source: "隔离测试", baseId: null, idempotencyKey: `test-${scope}-context` });
  await publishContext(manager, draft.proposalId, true);
  return draft.revisionId;
}
beforeEach(async () => {
  await resetDatabase();
  vi.stubEnv("SESSION_SECRET", "contextual-agent-isolated-test-secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("一个入口按意图选择业务工具", () => {
  it("研发入口组合找款和审版工具，读取各自发布版本，保留独立对象核验", async () => {
    const common = await publish("company"), development = await publish("development"), review = await publish("review");
    let step = 0;
    const run = await runBusinessAgent(sales, "product", "找 ST-26018 并核对资料批准", async messages => {
      step += 1;
      if (step === 1) return call("styles_find_records", { query: "ST-26018" });
      if (step === 2) return call("styles_read_evidence", { id: JSON.parse(messages.at(-1)!.content!).candidates[0].id });
      if (step === 3) return call("review_find_records", { query: "ST-26018" });
      if (step === 4) return call("review_read_evidence", { id: JSON.parse(messages.at(-1)!.content!).candidates[0].id });
      return { content: "已核对款式与资料批准记录。" };
    });
    expect(run.steps).toHaveLength(4);
    expect(run.context.references.map(r => r.revisionId)).toEqual([common, development, review]);
    expect(run.cards.some(c => c.title.includes("资料已批准"))).toBe(true);
    expect(run.tables.filter(t => t.title.endsWith("资料版次"))).toHaveLength(2);
    const tools = businessTools(sales, "product", "ST-26018").tools;
    const found = await tools.find(t => t.name === "styles_find_records")!.run({ query: "ST-26018" }) as { candidates: { id: string }[] };
    await expect(tools.find(t => t.name === "review_read_evidence")!.run({ id: found.candidates[0].id })).rejects.toThrow(/先查询/);
  });

  it("生产入口可核对排产和交期风险，不能直接批准投产或修改交期", async () => {
    const registry = businessTools(manager, "production", "DEMO-ORD-001 排产与交期风险");
    const tools = registry.tools;
    expect(tools.map(t => t.name)).toEqual(["schedule_find_records", "schedule_read_evidence", "progress_list_due_orders", "progress_read_order_risks"]);
    const before = await prisma.salesOrder.findMany({ orderBy: { id: "asc" } });
    const found = await tools[0].run({ query: "DEMO-ORD-001" }) as { candidates: { id: string }[] };
    await tools[1].run({ id: found.candidates[0].id });
    const due = await tools[2].run({ from: "2026-09-24", to: "2026-09-30" }) as { orders: { id: string }[] };
    if (due.orders.length) await tools[3].run({ orderIds: due.orders.map(o => o.id) });
    expect(registry.cards.flatMap(c => c.facts).join()).toContain("主管确认");
    expect(registry.tables.some(t => t.title.endsWith("询厂比较"))).toBe(true);
    expect(registry.tables.some(t => t.title.includes("交期与执行核对"))).toBe(true);
    expect(await prisma.salesOrder.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});

describe("跟单表头建议接原建表流程", () => {
  it("建议不写业务；人工改后确认只建跟单表，审计包含原建议和实际修改，重复提交不重建", async () => {
    const before = { sheets: await prisma.orderMerchSheet.count(), orders: await prisma.salesOrder.count(), purchases: await prisma.purchaseDraft.count() };
    const preview = await followPreview();
    expect(preview.followDraft).toEqual(suggestion);
    expect(await prisma.orderMerchSheet.count()).toBe(before.sheets);
    const input = { ...sales, ...suggestion, title: "人工核对后的表名", idempotencyKey: "follow-human-confirm", assistantTicket: preview.followTicket!, confirmed: true };
    const created = await createFollowSheet(input);
    expect((await createFollowSheet(input)).sheetId).toBe(created.sheetId);
    expect(await prisma.orderMerchSheet.count()).toBe(before.sheets + 1);
    expect(await prisma.salesOrder.count()).toBe(before.orders);
    expect(await prisma.purchaseDraft.count()).toBe(before.purchases);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "follow.sheet_created", entityId: created.sheetId } });
    expect(audit.actorUserId).toBe(sales.userId);
    expect(audit.createdAt).toBeInstanceOf(Date);
    const payload = JSON.parse(audit.payloadJson!);
    expect(payload.before).toBeNull();
    expect(payload.after).toEqual({ ...suggestion, title: input.title });
    expect(payload.assistant.original).toEqual(suggestion);
    expect(payload.assistant.model).toBe("test-transport");
    await expect(createFollowSheet({ ...input, title: "同一编号不同表名" })).rejects.toThrow(/其他表头/);
  });

  it("未确认、篡改凭据、换账号或已撤销账号均不能以建议建表", async () => {
    const before = await prisma.orderMerchSheet.count();
    const preview = await followPreview();
    const input = { ...sales, ...suggestion, idempotencyKey: "follow-reject-confirm", assistantTicket: preview.followTicket!, confirmed: true };
    await expect(createFollowSheet({ ...input, confirmed: false })).rejects.toThrow(/明确确认/);
    await expect(createFollowSheet({ ...input, assistantTicket: `broken${input.assistantTicket}` })).rejects.toThrow(/校验失败/);
    await expect(createFollowSheet({ ...input, ...manager })).rejects.toThrow(/当前账号/);
    await prisma.user.update({ where: { id: sales.userId }, data: { active: false } });
    await expect(createFollowSheet(input)).rejects.toThrow(/当前账号/);
    expect(await prisma.orderMerchSheet.count()).toBe(before);
  });

  it("发布跟单或全局新规则后旧建议不能建表；成功建表的原请求仍能恢复结果", async () => {
    const preview = await followPreview();
    const input = { ...sales, ...suggestion, idempotencyKey: "follow-context-created", assistantTicket: preview.followTicket!, confirmed: true };
    const created = await createFollowSheet(input);
    await publish("follow");
    await expect(createFollowSheet({ ...input, idempotencyKey: "follow-context-rejected" })).rejects.toThrow(/规则已更新/);
    expect((await createFollowSheet(input)).sheetId).toBe(created.sheetId);
    const fresh = await followPreview();
    await publish("company");
    await expect(createFollowSheet({ ...input, assistantTicket: fresh.followTicket!, idempotencyKey: "follow-global-rejected" })).rejects.toThrow(/规则已更新/);
  });

  it("类型及大货工厂是服务端门槛，未核对规则不能准备，额外款式或数量字段拒绝", async () => {
    const registry = businessTools(sales, "follow", "帮我建表");
    await expect(registry.tools.find(tool => tool.name === "prepare_follow_header")!.run(suggestion)).rejects.toThrow(/先核对/);
    await registry.tools.find(tool => tool.name === "read_follow_setup")!.run({ factoryQuery: "云杉" });
    await expect(registry.tools.find(tool => tool.name === "prepare_follow_header")!.run({ ...suggestion, factoryName: "" })).rejects.toThrow(/明确工厂/);
    await expect(registry.tools.find(tool => tool.name === "prepare_follow_header")!.run({ ...suggestion, kind: "sales_sample" })).rejects.toThrow(/不按工厂/);
    await expect(registry.tools.find(tool => tool.name === "prepare_follow_header")!.run({ ...suggestion, qty: 100 })).rejects.toThrow();
    const salesSample = { ...suggestion, kind: "sales_sample", factoryName: "" };
    await registry.tools.find(tool => tool.name === "prepare_follow_header")!.run(salesSample);
    expect(registry.getFollowDraft!()).toEqual(salesSample);
    await expect(createFollowSheet({ ...sales, ...suggestion, kind: "mixed", idempotencyKey: "follow-type-reject" })).rejects.toThrow(/销售样或大货/);
    await expect(createFollowSheet({ ...sales, ...suggestion, factoryName: "", idempotencyKey: "follow-factory-reject" })).rejects.toThrow(/哪家工厂/);
  });
});
