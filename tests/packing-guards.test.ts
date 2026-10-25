import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createPackingDraft, occupyPackingPlan, shipPackingPlan } from "@/server/services/packing";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const cartons = [{ cartonNo: "G-1", lines: [{ colorName: "海军蓝", sizeCode: "S", quantity: 1 }] }];
async function draft(key: string) {
  return createPackingDraft({ ...actor, orderId: "order-demo-005", cartons, idempotencyKey: key });
}
describe("装箱明细和发运事务", () => {
  beforeEach(resetDatabase);
  it("不接受订单外颜色和尺码", async () => {
    await expect(createPackingDraft({ ...actor, orderId: "order-demo-005", idempotencyKey: "wrong-color", cartons: [{ cartonNo: "G-1", lines: [{ colorName: "不存在", sizeCode: "ZZ", quantity: 1 }] }] })).rejects.toThrow(/颜色|尺码/);
    expect(await prisma.packingPlan.count({ where: { idempotencyKey: "wrong-color" } })).toBe(0);
  });
  it("不同装箱方案复用请求键也不能漏记第二次发运", async () => {
    for (const key of ["pack-one", "pack-two"]) {
      const { plan } = await draft(key);
      await occupyPackingPlan({ ...actor, planId: plan.id, idempotencyKey: "same-occupy-key" });
      await shipPackingPlan({ ...actor, planId: plan.id, idempotencyKey: "same-ship-key" });
    }
    const shipped = await prisma.productionQty.aggregate({ where: { orderId: "order-demo-005", kind: "shipped" }, _sum: { quantity: true } });
    expect(shipped._sum.quantity).toBe(982);
  });
  it("同方案并发提交不同请求键只发运一次", async () => {
    const { plan } = await draft("parallel-plan");
    await occupyPackingPlan({ ...actor, planId: plan.id, idempotencyKey: "occupy-parallel" });
    const results = await Promise.allSettled(["ship-a", "ship-b"].map(idempotencyKey => shipPackingPlan({ ...actor, planId: plan.id, idempotencyKey })));
    expect(results.some(result => result.status === "fulfilled")).toBe(true);
    const shipped = await prisma.productionQty.aggregate({ where: { orderId: "order-demo-005", kind: "shipped" }, _sum: { quantity: true } });
    expect(shipped._sum.quantity).toBe(981);
  });
  it("草稿与审计必须一起提交", async () => {
    await expect(createPackingDraft({ ...actor, userId: "missing-user", orderId: "order-demo-005", cartons, idempotencyKey: "missing-audit" })).rejects.toThrow();
    expect(await prisma.packingPlan.count({ where: { idempotencyKey: "missing-audit" } })).toBe(0);
  });
  it("幂等键已用于另一张订单时必须拒绝", async () => {
    await draft("same-draft-key");
    await expect(createPackingDraft({ ...actor, orderId: IDS.orderShortage, cartons, idempotencyKey: "same-draft-key" })).rejects.toThrow(/幂等|订单|色尺/);
  });
});
