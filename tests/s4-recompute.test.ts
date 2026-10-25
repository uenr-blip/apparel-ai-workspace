import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { adoptPurchaseOption } from "./purchase-preview";
import { applyInboundEtaChange, getPurchaseOptions } from "@/server/services/purchase-options";
import { resetDatabase } from "./helpers";

describe("S4 供给变化后必须重算", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("在途改晚后旧采购草稿过期，当前方案变为 1425/1430，不编造延期概率", async () => {
    await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });

    await applyInboundEtaChange({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
      lotId: "lot-mat001-inb",
      inboundEta: "2026-10-08",
      expectedEta: "2026-09-28",
    });

    const comparison = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage);
    expect(comparison.adopted?.status).toBe("stale");
    expect(comparison.adopted?.qty).toBe("1230");
    expect(comparison.lines[0]?.optionA.net).toBe("1425");
    expect(comparison.lines[0]?.optionA.buy).toBe("1430");
    expect(comparison.lines[0]?.optionA.amountYuan).toBe("28600.00");
    expect(comparison.poIssued).toBe(false);
    expect(comparison.facts.join(" ")).toContain("方案需重算");
    expect(comparison.facts.join(" ")).not.toContain("延期概率");
    expect(comparison.facts.join(" ")).toContain("未下达采购");

    const draft = await prisma.purchaseDraft.findFirstOrThrow({ where: { orderId: IDS.orderShortage } });
    expect(draft.status).toBe("stale");

    const recomputed = await adoptPurchaseOption({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: IDS.orderShortage,
      materialId: IDS.materialMat001,
      optionCode: "A",
    });
    expect(recomputed.reused).toBe(false);
    expect(recomputed.purchaseDraft.qty).toBe("1430");
    expect(recomputed.purchaseDraft.status).toBe("draft");
    const oh = await prisma.inventoryLot.findUniqueOrThrow({ where: { id: "lot-mat001-oh" } });
    expect(oh.qtyAllocated).toBe("170");
  });
});
