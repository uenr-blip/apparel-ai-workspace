import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { consumeInventory, transferInventory } from "@/server/services/inventory-move";
import { resetDatabase } from "./helpers";

const input = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", lotId: IDS.lotD06Wh, toLocationId: IDS.factoryYunshan, qty: "100", idempotencyKey: "move-100" };
describe("查料后的办理记录", () => {
  beforeEach(resetDatabase);
  it("同键不同数量不能冒充已办过", async () => {
    await transferInventory(input);
    await expect(transferInventory({ ...input, qty: "10" })).rejects.toThrow(/不一致|不同/);
  });
  it("并发调出不能重复花掉同一份余额", async () => {
    const results = await Promise.allSettled(["a", "b"].map(key => transferInventory({ ...input, qty: "150", idempotencyKey: key })));
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: IDS.lotD06Wh } })).qtyOnHand).toBe("50");
    expect(await prisma.inventoryMovement.count({ where: { materialId: IDS.materialD06 } })).toBe(1);
  });
  it("不同来源批次调入同工厂时保留独立记录", async () => {
    const source = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: IDS.lotD06Wh } });
    await prisma.inventoryLot.create({ data: { ...source, id: "second-source" } });
    const first = await transferInventory(input);
    const second = await transferInventory({ ...input, lotId: "second-source", idempotencyKey: "second-move" });
    expect(first.toLotId).not.toBe(second.toLotId);
  });
  it.each([{ qualityStatus: "pending" }, { ownerKind: "customer" }, { inboundEta: "2099-01-01" }, { availableFrom: "2099-01-01" }])("不可办理的批次在服务端拒绝 %j", async change => {
    await prisma.inventoryLot.update({ where: { id: IDS.lotD06Wh }, data: change });
    await expect(transferInventory(input)).rejects.toThrow();
    expect(await prisma.inventoryMovement.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(0);
  });
  it("审计失败时调拨余额和凭证一起回滚", async () => {
    await expect(transferInventory({ ...input, userId: "missing" })).rejects.toThrow();
    expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: IDS.lotD06Wh } })).qtyOnHand).toBe("200");
    expect(await prisma.inventoryMovement.count({ where: { idempotencyKey: input.idempotencyKey } })).toBe(0);
  });
  it("领用重试绑定批次和数量，不能改为另一笔", async () => {
    const moved = await transferInventory(input);
    const consume = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", lotId: moved.toLotId!, qty: "40", idempotencyKey: "use-40" };
    await consumeInventory(consume);
    await expect(consumeInventory({ ...consume, qty: "50" })).rejects.toThrow(/不一致|不同/);
  });
  it("领用审计失败不扣余额", async () => {
    const moved = await transferInventory(input);
    await expect(consumeInventory({ organizationId: IDS.orgDemo, userId: "missing", role: "manager", lotId: moved.toLotId!, qty: "40", idempotencyKey: "use-fail" })).rejects.toThrow();
    expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: moved.toLotId! } })).qtyOnHand).toBe("100");
  });
  it("办理整数数量时不能把历史小数余额四舍五入丢掉", async () => {
    await prisma.inventoryLot.update({ where: { id: IDS.lotD06Wh }, data: { qtyOnHand: "10.5" } });
    const moved = await transferInventory({ ...input, qty: "1" });
    expect(moved.fromOnHand).toBe("9.5");
    expect(moved.companyOnHand).toBe("10.5");
  });
});
