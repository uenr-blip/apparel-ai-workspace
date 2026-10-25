import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { generateFactoryReconDraft, listFinanceReconciliations } from "@/server/services/recon";
import { setUserPermission } from "@/server/services/user-permissions";
import { computeReconDraft } from "@/server/domain/recon";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const input = { ...actor, orderId: "order-demo-005", idempotencyKey: "finance-first" };
describe("财务核对加工草稿", () => {
  beforeEach(resetDatabase);
  it("能使用财务确认的本单加工单价与依据", async () => {
    const result = await generateFactoryReconDraft({ ...input, unitPriceYuan: "13.25", basisNote: "本单加工报价已核对" });
    expect(result.draft.amountYuan).toBe("12985.00");
    expect(result.draft.basisNote).toBe("本单加工报价已核对");
    expect(result.draft.paid).toBe(false);
  });
  it("后续出运变化可更新同一草稿并保留前后审计", async () => {
    const first = await generateFactoryReconDraft(input);
    await prisma.productionQty.create({ data: { id: "finance-more-shipped", orderId: input.orderId, kind: "shipped", quantity: 10, idempotencyKey: "finance-more-shipped" } });
    const second = await generateFactoryReconDraft({ ...input, idempotencyKey: "finance-second" });
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.draft.shippedQty).toBe(990);
    expect(second.draft.amountYuan).toBe("12375.00");
    expect(await prisma.auditEvent.count({ where: { entityId: first.draft.id, action: "recon.draft.updated" } })).toBe(1);
  });
  it("旧预览不能覆盖已经变化的出运依据", async () => {
    await expect(generateFactoryReconDraft({ ...input, expectedSnapshot: "old-preview" })).rejects.toThrow(/预览|变化/);
    expect(await prisma.factoryReconDraft.count()).toBe(0);
  });
  it("审计失败不能留下对账金额", async () => {
    await expect(generateFactoryReconDraft({ ...input, userId: "missing-user" })).rejects.toThrow();
    expect(await prisma.factoryReconDraft.count()).toBe(0);
  });
  it("不接受Infinity，也不把精细单价显示成另一单价", () => {
    expect(computeReconDraft({ shippedQty: 100, unitPriceYuan: "Infinity", basisNote: "测试" }).status).toBe("needs_basis");
    const result = computeReconDraft({ shippedQty: 100, unitPriceYuan: "1.005", basisNote: "测试" });
    expect(result.unitPriceYuan).toBe("1.005");
    expect(result.amountYuan).toBe("100.50");
  });
  it("同一请求重试时等值单价不会被当成不同内容", async () => {
    const request = { ...input, unitPriceYuan: "13.250", basisNote: "已核对本单报价" };
    const first = await generateFactoryReconDraft(request);
    const repeated = await generateFactoryReconDraft(request);
    expect(repeated.reused).toBe(true);
    expect(repeated.draft.id).toBe(first.draft.id);
  });
  it("财务查阅随经理授权生效，撤权后旧身份也不可查", async () => {
    const employee = { ...actor, userId: IDS.userSales, role: "salesperson" };
    await expect(listFinanceReconciliations(employee)).rejects.toThrow(/无权/);
    await setUserPermission({ organizationId: IDS.orgDemo, managerId: IDS.userManager, targetUserId: IDS.userSales, action: "generate_factory_recon", enabled: true });
    expect((await listFinanceReconciliations(employee)).rows.some(row => row.orderNo === "DEMO-ORD-005")).toBe(true);
    await setUserPermission({ organizationId: IDS.orgDemo, managerId: IDS.userManager, targetUserId: IDS.userSales, action: "generate_factory_recon", enabled: false });
    await expect(listFinanceReconciliations(employee)).rejects.toThrow(/无权/);
  });
  it("财务列表给出的预览可直接用于保存，不发生误报过期", async () => {
    const preview = (await listFinanceReconciliations(actor)).rows.find(row => row.orderId === input.orderId)!;
    const saved = await generateFactoryReconDraft({ ...input, expectedSnapshot: preview.snapshot });
    expect(saved.draft.amountYuan).toBe("12250.00");
  });
});
