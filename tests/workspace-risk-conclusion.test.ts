import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { currentWeekRange } from "@/lib/agent-delivery-range";
import { businessTools } from "@/server/agents/business-tools";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { resetDatabase } from "./helpers";
import { sha256 } from "@/lib/hash";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const query = { from: "2026-09-25", to: "2026-10-01" };

it("自然周使用上海日期；周日、跨年和明确日期不误变成未来七天", () => {
  expect(currentWeekRange("这周要交的订单有哪些风险", new Date("2026-09-25T02:00:00Z"))).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  expect(currentWeekRange("本周订单", new Date("2026-09-27T15:59:00Z"))).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  expect(currentWeekRange("本周订单", new Date("2026-09-27T16:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  expect(currentWeekRange("本周订单", new Date("2027-01-01T02:00:00Z"))).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  for (const text of ["本周与下周", "本周五到周日", "本周末", "本周剩下的几天", "本周，指定2026-09-25到2026-09-26", "未来7天"]) expect(currentWeekRange(text)).toBeNull();
});

describe("交期空结果与核对覆盖", () => {
  beforeEach(async () => { await resetDatabase(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-25T02:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("模型传成未来七天仍按本周查；列出缺交期订单及处理链接，不漏入其他公司/草稿", async () => {
    const before = await prisma.salesOrder.findMany({ orderBy: { id: "asc" } });
    const registry = businessTools(actor, "workspace", "这周要交的订单有哪些风险");
    const data = await registry.tools[0].run(query) as { range: typeof query; orders: { id: string }[]; unconfirmedDeliveryOrders: number };
    expect(data.range).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(data.orders).toEqual([]);
    const unknown = before.filter(o => o.organizationId === actor.organizationId && !["draft", "completed", "cancelled"].includes(o.status) && o.requestedDeliveryDate === null);
    expect(data.unconfirmedDeliveryOrders).toBe(unknown.length);
    expect(unknown.length).toBeGreaterThan(0);
    expect(registry.tables[0].conclusion).toMatchObject({ tone: "incomplete", title: "暂时无法判断交期风险" });
    const missing = registry.tables.find(t => t.title.startsWith("交期待补齐"))!;
    expect(missing.rows.map(r => r.href).sort()).toEqual(unknown.map(o => `/orders/${o.id}#prep`).sort());
    expect(missing.notes?.join()).toContain("未认定为本周订单");
    await expect(registry.tools[1].run({ orderIds: [unknown[0].id] })).rejects.toThrow(/查询范围/);
    expect(await prisma.salesOrder.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });

  it("只核对部分订单必须显示未核对数量；再次列单清除上次覆盖状态", async () => {
    const ids = [IDS.orderShortage, IDS.orderColorHold];
    await prisma.salesOrder.updateMany({ where: { id: { in: ids } }, data: { requestedDeliveryDate: "2026-09-25", status: "confirmed" } });
    const registry = businessTools(actor, "workspace", "本周订单风险");
    await registry.tools[0].run(query);
    await registry.tools[1].run({ orderIds: [ids[0]] });
    expect(registry.hasEvidence()).toBe(false);
    expect(registry.tables[0].conclusion?.detail).toContain("还有 1 张尚未核对");
    expect(registry.tables[0].conclusion?.title).toContain("待处理事项");
    await registry.tools[1].run({ orderIds: [ids[1]] });
    expect(registry.hasEvidence()).toBe(true);
    expect(registry.tables[0].conclusion?.detail).toContain("已核对 2 张");
    await registry.tools[0].run(query);
    expect(registry.hasEvidence()).toBe(false);
    expect(registry.tables.filter(t => t.conclusion).at(-1)?.conclusion?.detail).toContain("已核对 0 张");
  });

  it("超出20单明示截断，未核对全部不能给全局无风险结论", async () => {
    await prisma.salesOrder.createMany({ data: Array.from({ length: 21 }, (_, i) => ({ id: `risk-limit-${i}`, orderNo: `RISK-${i}`, organizationId: actor.organizationId, customerId: IDS.customerNorthshore, status: "confirmed", productionReadiness: "pending", requestedDeliveryDate: "2026-09-25" })) });
    const registry = businessTools(actor, "workspace", "本周订单风险");
    await registry.tools[0].run(query);
    expect(registry.tables[0].rows).toHaveLength(20);
    expect(registry.tables[0].conclusion?.detail).toContain("超过 20 张");
    expect(registry.tables[0].notes?.join()).toContain("最多核对 20 单");
  });

  it("完整查询带新上下文及可核对结论，查询留审计且不改订单", async () => {
    const before = await prisma.salesOrder.findMany({ orderBy: { id: "asc" } });
    let step = 0;
    const run = await runBusinessAgent(actor, "workspace", "这周要交的订单有哪些风险", async messages => {
      expect(messages[0].content).toContain("本周为 2026-09-21 至 2026-09-27");
      expect(messages[0].content).toContain("空结果");
      return ++step === 1 ? { content: null, tool_calls: [{ id: "list", type: "function", function: { name: "list_due_orders", arguments: JSON.stringify(query) } }] } : { content: "本周没有到期订单，因此不存在交期风险。" };
    });
    expect(run.tables[0].conclusion?.title).toBe("暂时无法判断交期风险");
    expect(run.context.platformVersion).toBe("yiju-context-1.3.3");
    expect(run.answer).toContain("暂时无法判断交期风险");
    expect(run.answer).not.toContain("不存在交期风险");
    const audit = await prisma.auditEvent.findUniqueOrThrow({ where: { id: run.runId } });
    expect(audit.actorUserId).toBe(actor.userId);
    expect(JSON.parse(audit.payloadJson!).tablesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(audit.payloadJson!).resultHash).toBe(sha256(run.answer));
    expect(await prisma.salesOrder.findMany({ orderBy: { id: "asc" } })).toEqual(before);
  });
});
