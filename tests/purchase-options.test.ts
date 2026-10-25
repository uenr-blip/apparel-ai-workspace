import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getPurchaseOptions, applyInboundEtaChange } from "@/server/services/purchase-options";
import { resetDatabase } from "./helpers";

const expected = JSON.parse(readFileSync("fixtures/expected-cases.json", "utf8")) as {
  procurementAllowanceCase: {
    expectedGrossRequirementMeters: string;
    expectedNetRequirementMeters: string;
    expectedSuggestedPurchaseMeters: string;
    expectedPurchaseLineAmountCNY: string;
    expectedPlannedExcessMeters: string;
  };
  noHistoricalStockCase: {
    expectedNetMeters: string;
    expectedPurchaseMeters: string;
    expectedLineAmountCNY: string;
    expectedNewPurchaseSpendDifferenceVsStockReuseCNY: string;
  };
  lateInboundCase: {
    expectedNetMeters: string;
    expectedPurchaseMeters: string;
    expectedLineAmountCNY: string;
  };
};

describe("S3 净需求与余料方案比较", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("DEMO-ORD-002 方案 A/B 对上演示数字，且未下达采购", async () => {
    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.orderNo).toBe("DEMO-ORD-002");
    expect(comparison.poIssued).toBe(false);
    expect(comparison.supplyNeedDate).toBe("2026-10-01");
    const line = comparison.lines[0];
    expect(line.materialCode).toBe("MAT-001");
    expect(line.gross).toBe(expected.procurementAllowanceCase.expectedGrossRequirementMeters);
    expect(line.freeStock).toBe("120");
    expect(line.timelyInbound).toBe("200");
    expect(line.optionA.net).toBe(expected.procurementAllowanceCase.expectedNetRequirementMeters);
    expect(line.optionA.buy).toBe(expected.procurementAllowanceCase.expectedSuggestedPurchaseMeters);
    expect(line.optionA.amountYuan).toBe(expected.procurementAllowanceCase.expectedPurchaseLineAmountCNY);
    expect(line.optionA.plannedExcess).toBe(expected.procurementAllowanceCase.expectedPlannedExcessMeters);
    expect(line.optionB.net).toBe(expected.noHistoricalStockCase.expectedNetMeters);
    expect(line.optionB.buy).toBe(expected.noHistoricalStockCase.expectedPurchaseMeters);
    expect(line.optionB.amountYuan).toBe(expected.noHistoricalStockCase.expectedLineAmountCNY);
    expect(line.spendDifferenceYuan).toBe(
      expected.noHistoricalStockCase.expectedNewPurchaseSpendDifferenceVsStockReuseCNY,
    );
    expect(comparison.facts.join(" ")).toContain("未下达采购");
    expect(comparison.facts.join(" ")).toContain("差额不是利润");
    expect(comparison.facts.join(" ")).not.toContain("利润增加");
    expect(comparison.next.kind).toBe("ready");
    expect(comparison.next.recommend).toBe("A");
    expect(comparison.next.label).toContain("采用余料方案 A");
  });

  it("在途改到需求日后，不得继续抵扣；附件文字不能自己改 ETA", async () => {
    const before = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-inb" } });
    expect(before.inboundEta).toBe("2026-09-28");

    await expect(
      applyInboundEtaChange({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: IDS.orderShortage,
        lotId: "lot-mat001-inb",
        inboundEta: "2026-10-08",
        expectedEta: "2026-09-28",
      }),
    ).rejects.toThrow("无权核验在途日期");

    const applied = await applyInboundEtaChange({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
      lotId: "lot-mat001-inb",
      inboundEta: "2026-10-08",
      expectedEta: "2026-09-28",
    });
    expect(applied.inboundEta).toBe("2026-10-08");

    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    const line = comparison.lines[0];
    expect(line.timelyInbound).toBe("0");
    expect(line.lateInbound).toBe("200");
    expect(line.optionA.net).toBe(expected.lateInboundCase.expectedNetMeters);
    expect(line.optionA.buy).toBe(expected.lateInboundCase.expectedPurchaseMeters);
    expect(line.optionA.amountYuan).toBe(expected.lateInboundCase.expectedLineAmountCNY);
    expect(comparison.poIssued).toBe(false);
  });

  it("外组织读不到本单方案", async () => {
    await expect(getPurchaseOptions(IDS.orgIso, IDS.orderShortage)).rejects.toThrow("订单不存在");
  });

  it("本单草稿没有面辅料时，按已批准资料比较，仍不下达采购", async () => {
    const draft = await prisma.styleVersion.create({
      data: {
        id: "version-st-26001-empty-draft",
        styleId: "style-st-26001",
        versionNumber: 99,
        status: "draft",
        cuffType: "常规",
        changeSummary: "空草稿",
      },
    });
    await prisma.orderLine.update({
      where: { id: "line-ord-002" },
      data: { styleVersionId: draft.id },
    });
    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.lines[0]?.optionA.net).toBe("1225");
    expect(comparison.facts.join(" ")).toContain("按该款已批准资料计算");
    expect(comparison.poIssued).toBe(false);
  });

  it("本单已收还占着的布继续抵扣，历史余料仍不进方案 B", async () => {
    await prisma.inventoryLot.update({
      where: { id: "lot-mat001-inb" },
      data: { qtyInbound: "0", qtyAllocated: "0" },
    });
    await prisma.inventoryLot.create({
      data: {
        id: "lot-mat001-recv",
        organizationId: IDS.orgDemo,
        materialId: IDS.materialMat001,
        locationId: IDS.warehouse,
        ownerKind: "company",
        colorName: "海军蓝",
        qtyOnHand: "200",
        qtyAllocated: "200",
        qtyInbound: "0",
        qualityStatus: "qualified",
        availableFrom: "2026-09-22",
        demoNote: "本单实收 200，已占用",
      },
    });
    await prisma.inventoryAllocation.create({
      data: { id: "alloc-ord002-recv", lotId: "lot-mat001-recv", orderId: IDS.orderShortage, qty: "200", status: "held" },
    });

    const line = (await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage)).lines[0];
    expect(line.freeStock).toBe("320");
    expect(line.timelyInbound).toBe("0");
    expect(line.optionA.net).toBe("1225");
    expect(line.optionA.buy).toBe("1230");
    expect(line.optionB.net).toBe("1345");
    expect(line.optionB.buy).toBe("1350");
    expect(line.optionB.amountYuan).toBe("27000.00");
    expect(line.optionB.allocatedFree).toBe("0");
    expect(line.spendDifferenceYuan).toBe("2400.00");
  });
});
