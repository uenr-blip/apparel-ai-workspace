import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import * as records from "@/server/services/resource-records";
import { transferInventory, consumeInventory } from "@/server/services/inventory-move";
import { resetDatabase } from "./helpers";

const manager = { role: "manager", factoryId: null };
const factory = { role: "factory", factoryId: IDS.factoryYunshan };
const move = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", lotId: IDS.lotD06Wh, toLocationId: IDS.factoryYunshan, qty: "100", idempotencyKey: "lookup-transfer" };
describe("资源中心现有料查阅", () => {
  beforeEach(resetDatabase);
  it("现货、在途、占用分别显示，不把在途当可调拨", async () => {
    const lot = await records.getLotRecord(IDS.orgDemo, "lot-mat001-oh", manager);
    expect(lot.availableQty).toBe("120");
    const inbound = await records.getLotRecord(IDS.orgDemo, "lot-mat001-inb", manager);
    expect(inbound.availableQty).toBe("0");
    expect(inbound.unavailableReasons.join(" ")).toContain("在途");
  });
  it("工厂不能通过批次ID看到别处的料", async () => {
    await expect(records.getLotRecord(IDS.orgDemo, IDS.lotD06Wh, factory)).rejects.toThrow(/批次|无权/);
  });
  it("调拨、领用后能查累计领用、余额和真实登记人", async () => {
    const result = await transferInventory(move);
    await consumeInventory({ organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", lotId: result.toLotId!, qty: "40", idempotencyKey: "lookup-consume" });
    const lot = await records.getLotRecord(IDS.orgDemo, result.toLotId!, manager);
    expect(lot.recordedConsumedQty).toBe("40");
    expect(lot.qtyOnHand).toBe("60");
    expect(lot.movements).toHaveLength(2);
    expect(lot.movements.every(row => row.actorName === "周衡")).toBe(true);
    expect(lot.movements.find(row => row.kind === "transfer")?.fromLocationName).toBe("原料库");
  });
  it("缺少历史审计不冒用当前登录人", async () => {
    await prisma.inventoryMovement.create({ data: { id: "legacy-use", organizationId: IDS.orgDemo, materialId: IDS.materialD06, kind: "consume", fromLotId: IDS.lotD06Wh, qty: "2", idempotencyKey: "legacy-use" } });
    const lot = await records.getLotRecord(IDS.orgDemo, IDS.lotD06Wh, manager);
    expect(lot.movements[0].actorName).toBe("未留存");
  });
  it("凭证分页不截断累计领用", async () => {
    await prisma.inventoryMovement.createMany({ data: Array.from({ length: 23 }, (_, n) => ({ id: `use-${n}`, organizationId: IDS.orgDemo, materialId: IDS.materialD06, kind: "consume", fromLotId: IDS.lotD06Wh, qty: "1", idempotencyKey: `use-${n}` })) });
    const first = await records.getLotRecord(IDS.orgDemo, IDS.lotD06Wh, manager, 1);
    const second = await records.getLotRecord(IDS.orgDemo, IDS.lotD06Wh, manager, 2);
    expect(first.movements).toHaveLength(20);
    expect(second.movements).toHaveLength(3);
    expect(first.recordedConsumedQty).toBe("23");
    expect(second.recordedConsumedQty).toBe("23");
  });
  it("多个关键词查询到真实批次并按页返回", async () => {
    expect(records.listInventoryLots).toBeTypeOf("function");
    const result = await records.listInventoryLots(IDS.orgDemo, manager, { q: "MAT-D06 原料库" });
    expect(result.rows.map(row => row.id)).toEqual([IDS.lotD06Wh]);
    expect(result.total).toBe(1);
  });
  it("工厂列表只含本厂，篡改地点筛选也不越权", async () => {
    expect(records.listInventoryLots).toBeTypeOf("function");
    const moved = await transferInventory(move);
    const result = await records.listInventoryLots(IDS.orgDemo, factory, {});
    expect(result.rows.map(row => row.id)).toEqual([moved.toLotId]);
    expect((await records.listInventoryLots(IDS.orgDemo, factory, { locationId: IDS.warehouse })).total).toBe(0);
    expect((await records.listInventoryLots(IDS.orgIso, manager, {})).rows.some(row => row.materialCode === "MAT-D06")).toBe(false);
  });
  it("库中35批次时列表每页最多20且不重叠", async () => {
    expect(records.listInventoryLots).toBeTypeOf("function");
    const sample = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: IDS.lotD06Wh } });
    await prisma.inventoryLot.createMany({ data: Array.from({ length: 34 }, (_, n) => ({ ...sample, id: `paged-${n}` })) });
    const first = await records.listInventoryLots(IDS.orgDemo, manager, { materialId: IDS.materialD06 });
    const second = await records.listInventoryLots(IDS.orgDemo, manager, { materialId: IDS.materialD06, page: 2 });
    expect(first.total).toBe(35);
    expect(first.rows).toHaveLength(20);
    expect(second.rows).toHaveLength(15);
    expect(first.rows.some(a => second.rows.some(b => a.id === b.id))).toBe(false);
  });
});
