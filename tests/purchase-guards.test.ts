import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getPurchaseOptions } from "@/server/services/purchase-options";
import { adoptPurchaseOption } from "./purchase-preview";
import { resetDatabase } from "./helpers";

const input = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", orderId: IDS.orderShortage, materialId: IDS.materialMat001, optionCode: "A" as const };
describe("采购口径与本单分配上限", () => {
  beforeEach(resetDatabase);
  it.each([{ unit: "kg" }, { currency: "USD" }, { multiple: "0" }, { moq: "-1" }])("不支持的报价不得产生可采用方案 %j", async change => {
    await prisma.supplierQuote.updateMany({ where: { organizationId: IDS.orgDemo, materialId: IDS.materialMat001 }, data: change });
    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.lines).toHaveLength(0);
    expect(comparison.facts.join(" ")).toMatch(/单位|币种|起订|倍数|报价/);
    await expect(adoptPurchaseOption(input)).rejects.toThrow();
    expect(await prisma.inventoryAllocation.count({ where: { orderId: IDS.orderShortage } })).toBe(0);
  });
  it("库存大于需求时只占本单所需且不预留多余在途", async () => {
    await prisma.inventoryLot.update({ where: { id: "lot-mat001-oh" }, data: { qtyOnHand: "10000" } });
    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.lines[0].optionA.plannedExcess).toBe("0");
    const result = await adoptPurchaseOption(input);
    expect(result.allocatedFree).toBe("1545");
    expect(result.reservedInbound).toBe("0");
    expect(result.purchaseDraft.qty).toBe("0");
  });
  it("已记录但未确认的单耗不能用于占库", async () => {
    await prisma.bomLine.updateMany({ where: { styleVersionId: "version-ST-26001-v1" }, data: { confirmed: false } });
    expect((await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage)).lines).toHaveLength(0);
    await expect(adoptPurchaseOption(input)).rejects.toThrow();
  });
  it("审计失败不能留下采购草稿或占用", async () => {
    await expect(adoptPurchaseOption({ ...input, userId: "missing-user" })).rejects.toThrow();
    expect(await prisma.purchaseDraft.count({ where: { orderId: IDS.orderShortage } })).toBe(0);
    expect(await prisma.inventoryAllocation.count({ where: { orderId: IDS.orderShortage } })).toBe(0);
    expect((await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } })).qtyAllocated).toBe("50");
  });
  it("预览后需求改变必须重新预览，不能静默采用新数量", async () => {
    const preview = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    await prisma.orderLine.updateMany({ where: { orderId: IDS.orderShortage }, data: { totalQuantity: 2000 } });
    await expect(adoptPurchaseOption({ ...input, expectedSnapshot: preview.lines[0].snapshot })).rejects.toThrow(/重算|预览/);
    expect(await prisma.purchaseDraft.count({ where: { orderId: IDS.orderShortage } })).toBe(0);
  });
  it("采用后本单已预留供给仍计入本单，不能制造新的采购缺口", async () => {
    const adopted = await adoptPurchaseOption(input);
    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.lines[0].optionA.buy).toBe(adopted.purchaseDraft.qty);
    expect(comparison.lines[0].freeStock).toBe("120");
    expect(comparison.lines[0].timelyInbound).toBe("200");
  });
});
