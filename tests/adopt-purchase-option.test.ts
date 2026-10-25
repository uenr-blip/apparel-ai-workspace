import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ExecutionError } from "@/server/services/execution";
import { adoptPurchaseOption } from "./purchase-preview";
import { getPurchaseOptions } from "@/server/services/purchase-options";
import { resetDatabase } from "./helpers";

async function createRacingOrder() {
  await prisma.salesOrder.create({
    data: {
      id: "order-s3-race",
      organizationId: IDS.orgDemo,
      orderNo: "DEMO-ORD-S3-RACE",
      customerId: IDS.customerNorthshore,
      factoryId: IDS.factoryYunshan,
      status: "confirmed",
      productionReadiness: "blocked_material",
      notes: "材料需求日 2026-10-01",
      lines: {
        create: {
          id: "line-s3-race",
          styleId: "style-st-26001",
          styleVersionId: "version-ST-26001-v1",
          totalQuantity: 1000,
        },
      },
    },
  });
}

describe("采用采购方案：占库 + 草稿，不下采购", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("方案 A 占用 120 米余料、预留 200 米在途，并写下 1230 米采购草稿", async () => {
    const result = await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });
    expect(result.reused).toBe(false);
    expect(result.poIssued).toBe(false);
    expect(result.purchaseDraft.status).toBe("draft");
    expect(result.purchaseDraft.qty).toBe("1230");
    expect(result.purchaseDraft.amountYuan).toBe("24600.00");
    expect(result.purchaseDraft.issued).toBe(false);
    expect(result.allocatedFree).toBe("120");
    expect(result.reservedInbound).toBe("200");

    const oh = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } });
    expect(oh.qtyAllocated).toBe("170");
    const inbound = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-inb" } });
    expect(inbound.qtyAllocated).toBe("200");
    expect(inbound.qtyOnHand).toBe("0");

    const held = await prisma.inventoryAllocation.findFirstOrThrow({
      where: { orderId: IDS.orderShortage, lotId: "lot-mat001-oh" },
    });
    expect(held.qty).toBe("120");
    expect(held.status).toBe("held");
    const planned = await prisma.inventoryAllocation.findFirstOrThrow({
      where: { orderId: IDS.orderShortage, lotId: "lot-mat001-inb" },
    });
    expect(planned.qty).toBe("200");
    expect(planned.status).toBe("planned");

    const drafts = await prisma.purchaseDraft.findMany({ where: { orderId: IDS.orderShortage } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("draft");

    const issued = await prisma.actionProposal.count({
      where: { organizationId: IDS.orgDemo, actionType: "issue_purchase_order" },
    });
    expect(issued).toBe(0);

    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.poIssued).toBe(false);
    expect(comparison.adopted?.optionCode).toBe("A");
    expect(comparison.adopted?.qty).toBe("1230");
    expect(comparison.next.kind).toBe("adopted");
    expect(comparison.next.label).toContain("余料已占住");
  });

  it("同一方案重复提交不重复占库", async () => {
    const first = await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });
    const second = await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });
    expect(second.reused).toBe(true);
    expect(second.purchaseDraft.id).toBe(first.purchaseDraft.id);
    const oh = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } });
    expect(oh.qtyAllocated).toBe("170");
    expect(await prisma.purchaseDraft.count({ where: { orderId: IDS.orderShortage } })).toBe(1);
  });

  it("两单同时抢 120 米，只能成功一次，失败者重算", async () => {
    await createRacingOrder();
    const attempts = await Promise.allSettled([
      adoptPurchaseOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: IDS.orderShortage,
        materialId: IDS.materialMat001,
        optionCode: "A",
      }),
      adoptPurchaseOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: "order-s3-race",
        materialId: IDS.materialMat001,
        optionCode: "A",
      }),
    ]);
    const ok = attempts.filter((row) => row.status === "fulfilled");
    const failed = attempts.filter((row) => row.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ExecutionError);
    expect(String((failed[0] as PromiseRejectedResult).reason)).toMatch(/库存已被其他订单占用|请刷新后重算/);
    const oh = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } });
    expect(oh.qtyAllocated).toBe("170");
  });

  it("方案 B 不占用余料，采购草稿 1350 米", async () => {
    const result = await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "B",
    });
    expect(result.allocatedFree).toBe("0");
    expect(result.reservedInbound).toBe("200");
    expect(result.purchaseDraft.qty).toBe("1350");
    expect(result.purchaseDraft.amountYuan).toBe("27000.00");
    expect(result.poIssued).toBe(false);
    const oh = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } });
    expect(oh.qtyAllocated).toBe("50");
    const inbound = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-inb" } });
    expect(inbound.qtyAllocated).toBe("200");
  });

  it("工厂和外组织不能采用；已采用 A 不能改成 B", async () => {
    await expect(
      adoptPurchaseOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId: IDS.orderShortage,
        materialId: IDS.materialMat001,
        optionCode: "A",
      }),
    ).rejects.toThrow("无权采用采购方案");

    await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });
    await expect(
      adoptPurchaseOption({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: IDS.orderShortage,
        materialId: IDS.materialMat001,
        optionCode: "B",
      }),
    ).rejects.toThrow("已采用方案 A");

    await expect(
      adoptPurchaseOption({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        orderId: IDS.orderShortage,
        materialId: IDS.materialMat001,
        optionCode: "A",
      }),
    ).rejects.toThrow("订单不存在");
  });
});
