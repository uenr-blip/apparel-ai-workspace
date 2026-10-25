import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { transferInventory, consumeInventory } from "@/server/services/inventory-move";
import { generateFactoryReconDraft } from "@/server/services/recon";
import { resetDatabase } from "./helpers";

async function grant(userId: string, action: string, enabled = true) {
  await prisma.organizationPolicy.upsert({
    where: { organizationId_key: { organizationId: IDS.orgDemo, key: `user-action:${userId}:${action}` } },
    create: { id: `grant-${userId}-${action}`, organizationId: IDS.orgDemo, key: `user-action:${userId}:${action}`, enabled, note: "测试授权", valueJson: "{}" },
    update: { enabled },
  });
}
const move = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", lotId: IDS.lotD06Wh, toLocationId: IDS.factoryYunshan, qty: "10", idempotencyKey: "delegated-move" };
describe("经理下发具体动作权限", () => {
  beforeEach(resetDatabase);
  it("获调拨授权的员工可办理，撤权后同一身份不能继续", async () => {
    await grant(IDS.userSales, "inventory_transfer");
    expect((await transferInventory(move)).reused).toBe(false);
    await grant(IDS.userSales, "inventory_transfer", false);
    await expect(transferInventory({ ...move, idempotencyKey: "after-revoke" })).rejects.toThrow(/无权/);
  });
  it("调拨权限不会顺带获得领用权限", async () => {
    await grant(IDS.userSales, "inventory_transfer");
    const moved = await transferInventory(move);
    await expect(consumeInventory({ ...move, lotId: moved.toLotId!, qty: "1", idempotencyKey: "no-consume-grant" })).rejects.toThrow(/无权/);
  });
  it("获对账授权的员工可生成草稿，仍不付款", async () => {
    await grant(IDS.userSales, "generate_factory_recon");
    const result = await generateFactoryReconDraft({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null, orderId: "order-demo-005", idempotencyKey: "delegated-recon" });
    expect(result.draft.amountYuan).toBe("12250.00");
    expect(result.draft.paid).toBe(false);
  });
  it("停用员工即使仍有授权也不能办理", async () => {
    await grant(IDS.userSales, "inventory_transfer");
    await prisma.user.update({ where: { id: IDS.userSales }, data: { active: false } });
    await expect(transferInventory(move)).rejects.toThrow(/无权/);
  });
  it("工厂获领用授权后仍不能操作其他地点", async () => {
    await grant(IDS.userFactory, "inventory_consume");
    const moved = await transferInventory({ ...move, role: "manager", userId: IDS.userManager });
    expect((await consumeInventory({ organizationId: IDS.orgDemo, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan, lotId: moved.toLotId!, qty: "1", idempotencyKey: "factory-use" })).reused).toBe(false);
    await expect(consumeInventory({ organizationId: IDS.orgDemo, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan, lotId: IDS.lotD06Wh, qty: "1", idempotencyKey: "factory-other" })).rejects.toThrow();
  });
});
