import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { searchOrderAssistant, previewOrderAssistant, confirmOrderAssistant } from "@/server/services/order-assistant";
import { approveProposal } from "@/server/services/execution";
import { getProductionGate } from "@/server/services/production-gate";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
const manager = { ...actor, userId: IDS.userManager, role: "manager" };
const text = "给北岸服饰建一个针织T恤订单，基础样已确认";

async function preview(as = actor, key = "order-agent-test-01") {
  const found = await searchOrderAssistant(as, text);
  const candidate = found.candidates.find(c => c.styleId === IDS.styleSt26018)!;
  expect(candidate).toBeTruthy();
  return previewOrderAssistant(as, { text, candidateId: candidate.id, idempotencyKey: key });
}

describe("一句话建单：有依据的预览与人工确认", () => {
  beforeEach(resetDatabase);

  it("检索和预览不建单；确认创建独立资料草稿、待办、审计；重试只建一单", async () => {
    const orderCount = await prisma.salesOrder.count();
    const styleCount = await prisma.style.count();
    const oldVersion = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    const p = await preview();
    expect(await prisma.salesOrder.count()).toBe(orderCount);
    await expect(confirmOrderAssistant(actor, { proposalId: p.proposalId, confirmed: false })).rejects.toThrow(/明确确认/);
    const result = await confirmOrderAssistant(actor, { proposalId: p.proposalId, confirmed: true });
    const again = await confirmOrderAssistant(actor, { proposalId: p.proposalId, confirmed: true });
    expect(again).toEqual(result);
    expect(await prisma.salesOrder.count()).toBe(orderCount + 1);
    expect(await prisma.style.count()).toBe(styleCount);
    expect(await prisma.styleVersion.findUnique({ where: { id: oldVersion.id } })).toEqual(oldVersion);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: result.orderId }, include: { lines: { include: { version: { include: { bomLines: true } }, colors: true } }, tasks: true, tradeContract: true, purchaseDrafts: true } });
    expect(order.status).toBe("draft");
    expect(order.createdByUserId).toBe(actor.userId);
    expect(order.externalCustomerPo).toBeNull();
    expect(order.requestedDeliveryDate).toBeNull();
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect((await getProductionGate(actor.organizationId, order.id)).ready).toBe(false);
    expect(order.lines[0].totalQuantity).toBe(0);
    expect(order.lines[0].colors).toHaveLength(0);
    expect(order.lines[0].version?.status).toBe("draft");
    expect(order.lines[0].version?.approvedAt).toBeNull();
    expect(order.lines[0].version?.bomLines.every(b => !b.confirmed)).toBe(true);
    expect(order.tradeContract).toBeNull();
    expect(order.purchaseDrafts).toHaveLength(0);
    expect(order.notes).toContain("跟单员陈述");
    expect(order.tasks.map(t => t.assigneeRole).sort()).toEqual(["manager", "salesperson"]);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: order.id, action: "order.assistant_draft_created" } });
    expect(audit.actorUserId).toBe(actor.userId);
    expect(audit.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(audit.payloadJson!).after.orderId).toBe(order.id);
  });

  it("同一预览并发重试不重复，幂等键不可换内容", async () => {
    const found = await searchOrderAssistant(actor, text);
    const input = { text, candidateId: found.candidates[0].id, idempotencyKey: "parallel-preview-key" };
    const [a, b] = await Promise.all([previewOrderAssistant(actor, input), previewOrderAssistant(actor, input)]);
    expect(a.proposalId).toBe(b.proposalId);
    await expect(previewOrderAssistant(actor, { ...input, text: text + "，稍后核对" })).rejects.toThrow(/另一份内容/);
    const count = await prisma.salesOrder.count();
    const [x, y] = await Promise.all([confirmOrderAssistant(actor, { proposalId: a.proposalId, confirmed: true }), confirmOrderAssistant(actor, { proposalId: a.proposalId, confirmed: true })]);
    expect(x).toEqual(y);
    expect(await prisma.salesOrder.count()).toBe(count + 1);
  });

  it("未授权、冒用角色、跨组织及其他发起人不能执行；通用提案批准不能绕过确认", async () => {
    await expect(searchOrderAssistant({ ...actor, userId: IDS.userFactory, role: "factory" }, text)).rejects.toThrow(/无权/);
    await expect(searchOrderAssistant({ ...actor, role: "manager" }, text)).rejects.toThrow(/无权/);
    await expect(searchOrderAssistant({ ...actor, organizationId: IDS.orgIso, userId: IDS.userIso }, text)).rejects.toThrow(/客户/);
    const p = await preview();
    await expect(confirmOrderAssistant(manager, { proposalId: p.proposalId, confirmed: true })).rejects.toThrow(/发起/);
    await expect(approveProposal({ ...actor, proposalId: p.proposalId })).rejects.toThrow(/一句话建单/);
    await prisma.user.update({ where: { id: actor.userId }, data: { active: false } });
    await expect(confirmOrderAssistant(actor, { proposalId: p.proposalId, confirmed: true })).rejects.toThrow(/无权/);
  });

  it("缺客户、多个客户、无匹配资料或伪造候选不猜测建单", async () => {
    await expect(searchOrderAssistant(actor, "给不存在的客户建一个针织订单")).rejects.toThrow(/客户/);
    await prisma.customer.create({ data: { id: "extra-customer", organizationId: IDS.orgDemo, code: "EXTRA", name: "另一客户", demoNote: "test" } });
    await expect(searchOrderAssistant(actor, text + "和另一客户")).rejects.toThrow(/歧义/);
    expect((await searchOrderAssistant(actor, "给北岸服饰建ST-NOT-FOUND订单")).candidates).toEqual([]);
    await expect(previewOrderAssistant(actor, { text, candidateId: "other-org-line", idempotencyKey: "bad-candidate-key" })).rejects.toThrow(/不可用/);
    expect(await prisma.actionProposal.count({ where: { source: { origin: "order-assistant" } } })).toBe(0);
  });

  it("资料内容变化或出现新批准版时拒绝旧预览，事务不留下半张单", async () => {
    const p = await preview();
    const count = await prisma.salesOrder.count();
    await prisma.styleVersion.update({ where: { id: p.candidate.versionId }, data: { specNotes: "新的尺寸要求" } });
    await expect(confirmOrderAssistant(actor, { proposalId: p.proposalId, confirmed: true })).rejects.toThrow(/已变化/);
    expect(await prisma.salesOrder.count()).toBe(count);
    expect(await prisma.actionExecution.count({ where: { proposalId: p.proposalId } })).toBe(0);
    const newer = await preview(actor, "new-preview-key");
    await prisma.styleVersion.create({ data: { id: "new-approved", styleId: newer.candidate.styleId, versionNumber: 1000, status: "approved", cuffType: "normal", changeSummary: "test" } });
    await expect(confirmOrderAssistant(actor, { proposalId: newer.proposalId, confirmed: true })).rejects.toThrow(/已变化/);
  });

  it("账期遵守现有查阅权限，不泄漏到共享提案；变化后必须重新确认", async () => {
    const found = await searchOrderAssistant(manager, text);
    const chosen = found.candidates.find(c => c.styleId === IDS.styleSt26018)!;
    await prisma.tradeContract.create({ data: { id: "terms-test", organizationId: IDS.orgDemo, orderId: chosen.orderId, currency: "CNY", amountMinor: 10000n, tradeMode: "unknown", incoterm: "", terms: "月结60天-财务受限参考", createdBy: manager.userId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    const salesResult = await searchOrderAssistant(actor, text);
    expect(salesResult.candidates.every(c => c.terms === null)).toBe(true);
    const p = await previewOrderAssistant(manager, { text, candidateId: chosen.id, idempotencyKey: "terms-preview-key" });
    expect(p.terms?.terms).toContain("月结60天");
    const stored = await prisma.actionProposal.findUniqueOrThrow({ where: { id: p.proposalId } });
    expect(JSON.stringify(stored)).not.toContain("月结60天");
    expect(JSON.stringify(await prisma.auditEvent.findMany({ where: { entityId: p.proposalId } }))).not.toContain("月结60天");
    await prisma.tradeContract.update({ where: { id: "terms-test" }, data: { terms: "现结", version: 2 } });
    await expect(confirmOrderAssistant(manager, { proposalId: p.proposalId, confirmed: true })).rejects.toThrow(/已变化/);
  });
});
