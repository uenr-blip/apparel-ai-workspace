import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getProductionBoard, recordProductionQty } from "@/server/services/production-board";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan };
describe("产量入口统一约束", () => {
  beforeEach(resetDatabase);
  it("工厂不能从产量入口绕过装箱直接发运", async () => {
    await expect(recordProductionQty({ ...actor, orderId: "order-demo-005", kind: "shipped", quantity: 1000, idempotencyKey: "bypass-ship" })).rejects.toThrow(/装箱/);
    expect(await prisma.productionQty.count({ where: { idempotencyKey: "bypass-ship" } })).toBe(0);
  });
  it("页面不可登记的阻塞订单在服务层也拒绝投产", async () => {
    const board = await getProductionBoard(IDS.orgDemo, actor);
    expect(board.rows.find(row => row.orderId === IDS.orderShortage)?.canRecord).toBe(false);
    await expect(recordProductionQty({ ...actor, orderId: IDS.orderShortage, kind: "started", quantity: 1, idempotencyKey: "blocked-start" })).rejects.toThrow(/投产|阻塞/);
  });
  it("新增合格与报废不能超过已登记投产", async () => {
    await expect(recordProductionQty({ ...actor, orderId: "order-demo-005", kind: "good", quantity: 1000, idempotencyKey: "excess-good" })).rejects.toThrow(/投产|数量/);
  });
  it("同一个幂等键不能改成另一笔数量", async () => {
    await expect(recordProductionQty({ ...actor, orderId: "order-demo-005", kind: "started", quantity: 1, idempotencyKey: "start-005" })).rejects.toThrow(/幂等|不一致/);
  });
  it("审计写入失败时数量一起回滚", async () => {
    await expect(recordProductionQty({ ...actor, userId: "missing-user", orderId: "order-demo-005", kind: "rework", quantity: 1, idempotencyKey: "audit-failed" })).rejects.toThrow();
    expect(await prisma.productionQty.count({ where: { idempotencyKey: "audit-failed" } })).toBe(0);
  });
});
