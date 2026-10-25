import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { issuePurchaseOrder } from "@/server/services/issue-purchase";
import { applyInboundEtaChange, getPurchaseOptions } from "@/server/services/purchase-options";
import { resetDatabase } from "./helpers";

const base = {
  organizationId: IDS.orgDemo,
  orderId: IDS.orderShortage,
  materialId: IDS.materialMat001,
};

async function draft(status: string) {
  return prisma.purchaseDraft.create({
    data: {
      id: "draft-issue-test",
      organizationId: IDS.orgDemo,
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "B",
      qty: "1350",
      amountYuan: "27000.00",
      allocatedFree: "0",
      reservedInbound: "0",
      status,
      idempotencyKey: `${IDS.orderShortage}:${IDS.materialMat001}`,
    },
  });
}

async function onHand() {
  const lots = await prisma.inventoryLot.findMany({
    where: { organizationId: IDS.orgDemo, materialId: IDS.materialMat001 },
    orderBy: { id: "asc" },
    select: { id: true, qtyOnHand: true, qtyAllocated: true, qtyInbound: true },
  });
  return lots;
}

describe("下达采购", () => {
  beforeEach(resetDatabase);

  it("同一提交标记不能下达两张不同的采购草稿", async () => {
    const first = await draft("draft");
    const second = await prisma.purchaseDraft.create({
      data: {
        id: "draft-issue-other",
        organizationId: IDS.orgDemo,
        orderId: IDS.orderShortage,
        materialId: "material-yarn-01",
        optionCode: "B",
        qty: "10",
        amountYuan: "100.00",
        allocatedFree: "0",
        reservedInbound: "0",
        status: "draft",
        idempotencyKey: "draft-other-01",
      },
    });
    const sharedKey = "issue-shared-01";
    await issuePurchaseOrder({ ...base, userId: IDS.userManager, role: "manager", expectedUpdatedAt: first.updatedAt.toISOString(), idempotencyKey: sharedKey });
    await expect(issuePurchaseOrder({
      organizationId: IDS.orgDemo,
      orderId: IDS.orderShortage,
      materialId: second.materialId,
      userId: IDS.userManager,
      role: "manager",
      expectedUpdatedAt: second.updatedAt.toISOString(),
      idempotencyKey: sharedKey,
    })).rejects.toThrow(/提交标记/);
    expect((await prisma.purchaseDraft.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("draft");
  });

  it("经理下达已有草稿，数量金额不变，在手不变，重复下达不改数", async () => {
    const created = await draft("draft");
    const before = await onHand();
    await expect(
      issuePurchaseOrder({
        ...base,
        userId: IDS.userSales,
        role: "salesperson",
        expectedUpdatedAt: created.updatedAt.toISOString(),
        idempotencyKey: "issue-sales",
      }),
    ).rejects.toThrow(/无权/);
    await expect(
      issuePurchaseOrder({
        ...base,
        userId: IDS.userFactory,
        role: "factory",
        expectedUpdatedAt: created.updatedAt.toISOString(),
        idempotencyKey: "issue-factory",
      }),
    ).rejects.toThrow(/无权/);
    await expect(
      issuePurchaseOrder({
        ...base,
        userId: IDS.userManager,
        role: "manager",
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
        idempotencyKey: "issue-stale-time",
      }),
    ).rejects.toThrow(/变化/);

    const issued = await issuePurchaseOrder({
      ...base,
      userId: IDS.userManager,
      role: "manager",
      expectedUpdatedAt: created.updatedAt.toISOString(),
      idempotencyKey: "issue-once",
    });
    expect(issued).toMatchObject({ reused: false, qty: "1350", amountYuan: "27000.00", status: "issued" });
    expect(await onHand()).toEqual(before);
    const saved = await prisma.purchaseDraft.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.status).toBe("issued");
    expect(saved.qty).toBe("1350");
    expect(saved.idempotencyKey).toBe(`${IDS.orderShortage}:${IDS.materialMat001}`);

    const again = await issuePurchaseOrder({
      ...base,
      userId: IDS.userManager,
      role: "manager",
      expectedUpdatedAt: saved.updatedAt.toISOString(),
      idempotencyKey: "issue-again",
    });
    expect(again.reused).toBe(true);
    expect(await prisma.auditEvent.count({ where: { entityId: created.id, action: "purchase.order.issued" } })).toBe(1);

    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.poIssued).toBe(true);
    expect(comparison.adopted?.issued).toBe(true);
    expect(comparison.adopted?.status).toBe("issued");
    expect(comparison.facts.join(" ")).toContain("已下达采购");
    expect(comparison.facts.join(" ")).toContain("未收料，未付款");
    expect(comparison.next.label).toContain("未收料，未付款");
  });

  it("过期草稿不能下达", async () => {
    const created = await draft("stale");
    await expect(
      issuePurchaseOrder({
        ...base,
        userId: IDS.userManager,
        role: "manager",
        expectedUpdatedAt: created.updatedAt.toISOString(),
        idempotencyKey: "issue-stale",
      }),
    ).rejects.toThrow(/过期/);
    expect((await prisma.purchaseDraft.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("stale");
  });

  it("已下达的采购单不因在途日期核验退回草稿", async () => {
    const created = await draft("issued");
    await applyInboundEtaChange({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
      lotId: "lot-mat001-inb",
      inboundEta: "2026-10-08",
      expectedEta: "2026-09-28",
    });
    const saved = await prisma.purchaseDraft.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.status).toBe("issued");
    expect(saved.qty).toBe("1350");
  });
});
