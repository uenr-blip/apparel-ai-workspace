import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getFinanceOverview, listFinanceVouchers } from "@/server/services/finance-board";
import { generateFactoryReconDraft, listFinanceReconciliations } from "@/server/services/recon";
import { setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
async function makeDraft(index: number, amountYuan: string) {
  const id = `finance-board-${index}`;
  await prisma.salesOrder.create({ data: { id, organizationId: actor.organizationId, orderNo: id, customerId: IDS.customerNorthshore, factoryId: IDS.factoryYunshan, status: "draft", productionReadiness: "ready",
    production: { create: [{ id: `${id}-good`, kind: "good", quantity: 1, idempotencyKey: `${id}-good` }, { id: `${id}-shipped`, kind: "shipped", quantity: 1, idempotencyKey: `${id}-shipped` }] },
    reconDrafts: { create: { id: `${id}-draft`, organizationId: actor.organizationId, factoryId: IDS.factoryYunshan, status: "draft", shippedQty: 1, unitPriceYuan: amountYuan, amountYuan, basisNote: "测试依据", idempotencyKey: id } },
  } });
}
describe("独立财务板块读模型", () => {
  beforeEach(resetDatabase);
  it("没有草稿时金额缺省，统计基于全部有出运的订单", async () => {
    const result = await getFinanceOverview(actor);
    expect(result.amountYuan).toBeNull();
    expect(result.draftCount).toBe(0);
    expect(result.states.missing).toBeGreaterThan(0);
    expect(result.pendingCount).toBe(result.orderCount);
  });
  it("金额用整数分精确聚合，排除异常并可下钻", async () => {
    await makeDraft(1, "0.10"); await makeDraft(2, "0.20"); await makeDraft(3, "invalid");
    const result = await getFinanceOverview(actor);
    expect(result.amountYuan).toBe("0.30");
    expect(result.excludedDraftCount).toBe(1);
    expect(result.factories[0].amountYuan).toBe("0.30");
    const review = await listFinanceReconciliations(actor, { state: "review" });
    expect(review.rows.map(row => row.orderId)).toEqual(["finance-board-3"]);
  });
  it("出运变化在概览和下钻列表中一致，列表预览仍可保存", async () => {
    await generateFactoryReconDraft({ ...actor, orderId: "order-demo-005", idempotencyKey: "board-first" });
    await prisma.productionQty.create({ data: { id: "board-more", orderId: "order-demo-005", kind: "shipped", quantity: 10, idempotencyKey: "board-more" } });
    expect((await getFinanceOverview(actor)).states.changed).toBe(1);
    const list = await listFinanceReconciliations(actor, { state: "changed" });
    expect(list.total).toBe(1);
    const result = await generateFactoryReconDraft({ ...actor, orderId: list.rows[0].orderId, expectedSnapshot: list.rows[0].snapshot, idempotencyKey: "board-second" });
    expect(result.draft.amountYuan).toBe("12375.00");
  });
  it("超过一页仍汇总全量，工厂和搜索可组合筛选", async () => {
    for (let i = 0; i < 21; i++) await makeDraft(i, "0.10");
    const result = await getFinanceOverview(actor);
    expect(result.amountYuan).toBe("2.10"); expect(result.draftCount).toBe(21);
    const page = await listFinanceReconciliations(actor, { state: "saved", factoryId: IDS.factoryYunshan, q: "finance-board", page: 2 });
    expect(page.total).toBe(21); expect(page.rows).toHaveLength(1);
    expect((await listFinanceReconciliations(actor, { q: "%' OR 1=1 --" })).total).toBe(0);
  });
  it("汇总与凭证遵守授权撤销和组织隔离", async () => {
    const employee = { ...actor, userId: IDS.userSales, role: "salesperson" };
    await expect(getFinanceOverview(employee)).rejects.toThrow(/无权/);
    await expect(listFinanceVouchers(employee)).rejects.toThrow(/无权/);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action: "generate_factory_recon", enabled: true });
    expect((await getFinanceOverview(employee)).orderCount).toBeGreaterThan(0);
    await makeDraft(1, "100.00");
    expect((await getFinanceOverview({ ...actor, organizationId: IDS.orgIso, userId: IDS.userIso })).amountYuan).toBeNull();
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action: "generate_factory_recon", enabled: false });
    await expect(listFinanceVouchers(employee)).rejects.toThrow(/无权/);
  });
  it("材料凭证按组织分页，不合并不同材料的数量", async () => {
    for (let i = 0; i < 21; i++) await prisma.inventoryMovement.create({ data: { id: `board-voucher-${i}`, organizationId: actor.organizationId, materialId: IDS.materialD06, kind: "consume", fromLotId: IDS.lotD06Wh, fromLocationId: IDS.warehouse, qty: "3", note: "财务查阅", idempotencyKey: `board-voucher-${i}` } });
    const list = await listFinanceVouchers(actor, { q: "财务查阅", page: 2 });
    expect(list.total).toBe(21); expect(list.rows).toHaveLength(1);
    expect(list.rows[0].qty).toBe("3"); expect(list.rows[0].materialName).toBeTruthy();
    expect((await listFinanceVouchers({ ...actor, organizationId: IDS.orgIso, userId: IDS.userIso })).total).toBe(0);
  });
});
