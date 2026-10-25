import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { evaluateProductionGate } from "@/server/domain/production-gate";
import { createMaterialMaster } from "@/server/services/material-create";
import { createOralOrderDraft } from "@/server/services/oral-order";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { saveOrderPrep } from "@/server/services/order-prep";
import { approveOrderSpec } from "@/server/services/style-version";
import { submitColorConfirmation } from "@/server/services/color-confirm";
import { createStyleMaster } from "@/server/services/style-create";
import { assertCannotReleaseToProduction, releaseToProduction } from "@/server/services/execution";
import { getProductionGate } from "@/server/services/production-gate";
import { recordProductionQty } from "@/server/services/production-board";
import { transferInventory } from "@/server/services/inventory-move";
import { runMaterialCommand } from "@/server/services/material-write";
import { getMaterialReceipt } from "@/server/services/material-read";
import { resetDatabase } from "./helpers";

const sales = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };
const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };

function sampleGate(overrides: Partial<Parameters<typeof evaluateProductionGate>[0]> = {}) {
  return evaluateProductionGate({
    status: "confirmed",
    productionReadiness: "color_approved",
    sizesAligned: true,
    specApproved: true,
    specTaskOpen: false,
    hasColors: true,
    colorsLatestApproved: true,
    canCut: true,
    cutLabel: "可开裁",
    cutBlockers: [],
    ...overrides,
  });
}

describe("投产门槛", () => {
  it("资料、分色、厂里有料都齐才可放行，缺一不可", () => {
    const ready = sampleGate();
    expect(ready.ready).toBe(true);
    expect(ready.label).toContain("可批准投产");
    expect(ready.checks.map((item) => item.id)).toEqual(["spec", "color", "factory_material"]);
    expect(sampleGate({ specApproved: false }).ready).toBe(false);
    expect(sampleGate({ specApproved: false }).blockers).toContain("资料未批准");
    expect(sampleGate({ sizesAligned: false }).blockers).toContain("色尺未齐");
    expect(sampleGate({ colorsLatestApproved: false }).blockers).toContain("分色未齐");
    expect(sampleGate({ canCut: false, cutLabel: "未到料", cutBlockers: ["未到料"] }).blockers).toContain("未到料");
  });

  it("资料或分色批准不会自动变成可投产；已出运不能再放行", () => {
    const afterSpec = sampleGate({
      productionReadiness: "spec_approved",
      colorsLatestApproved: false,
      canCut: false,
      cutBlockers: ["未到料"],
    });
    expect(afterSpec.alreadyReleased).toBe(false);
    expect(afterSpec.ready).toBe(false);

    const shipped = sampleGate({ status: "completed", productionReadiness: "shipped" });
    expect(shipped.ready).toBe(false);
    expect(shipped.alreadyDone).toBe(true);
    expect(shipped.blockers).toContain("已出运");
  });

  it("余料未占不挡投产；已放行不因后来缺色而收回", () => {
    const leftoverOpen = sampleGate();
    expect(leftoverOpen.ready).toBe(true);
    expect(leftoverOpen.facts.join(" ")).toContain("余料未占不挡投产");
    expect(leftoverOpen.facts.join(" ")).toContain("正式采购未下达");

    const kept = sampleGate({
      productionReadiness: "ready_for_production",
      colorsLatestApproved: false,
    });
    expect(kept.ready).toBe(true);
    expect(kept.alreadyReleased).toBe(true);
    expect(kept.checks.find((item) => item.id === "color")?.passed).toBe(false);
  });
});

describe("投产门槛服务", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("历史已出运单不能再批准投产", async () => {
    await expect(assertCannotReleaseToProduction(IDS.orderHistorical)).rejects.toThrow(/不能批准投产/);
    await expect(releaseToProduction({ ...manager, orderId: IDS.orderHistorical })).rejects.toThrow(/出运|投产/);
  });

  it("资料批准后仍不是可投产；门槛齐后经理可放行，业务员不能放行，放行后才能记产量", async () => {
    const style = await createStyleMaster({
      ...sales,
      code: "ST-GATE-01",
      name: "投产门槛针织",
      category: "针织上衣",
      silhouette: "圆领",
    });
    const material = await createMaterialMaster({
      ...sales,
      code: "MAT-GATE-01",
      name: "门槛汗布",
      kind: "fabric",
      specSummary: "门槛案例",
      unit: "m",
    });
    const oral = await createOralOrderDraft({
      ...sales,
      customerId: IDS.customerNorthshore,
      styleId: style.styleId,
      factoryId: IDS.factoryYunshan,
      colors: [
        { colorName: "海军蓝", quantity: 20 },
        { colorName: "灰色", quantity: 10 },
      ],
      idempotencyKey: "gate-oral-01",
    });
    const orderId = oral.orderId;
    await saveStyleBomDraft({
      ...sales,
      styleId: style.styleId,
      materialIds: [material.materialId],
      consumptions: { [material.materialId]: "0.5" },
    });
    const stamp = async () => (await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } })).updatedAt.toISOString();
    await saveOrderPrep({
      ...sales,
      orderId,
      sizes: [
        { colorName: "海军蓝", breakdown: { S: 8, M: 12 } },
        { colorName: "灰色", breakdown: { S: 4, M: 6 } },
      ],
      confirmedDeliveryDate: "2026-10-15",
      ribSpec: "2x2 罗纹，门槛案例",
      expectedUpdatedAt: await stamp(),
    });
    const approved = await approveOrderSpec({
      ...manager,
      orderId,
      expectedUpdatedAt: await stamp(),
    });
    expect(approved.productionReadiness).not.toBe("ready_for_production");

    await expect(releaseToProduction({ ...manager, orderId })).rejects.toThrow(/分色|未到料|厂里|不能批准投产/);

    for (const colorName of ["海军蓝", "灰色"]) {
      await submitColorConfirmation({
        ...sales,
        orderId,
        materialId: material.materialId,
        colorName,
        status: "approved",
        evidence: "门槛案例分色，不是图片终审",
      });
    }
    await expect(releaseToProduction({ ...manager, orderId })).rejects.toThrow(/未到料|未调到厂|厂里/);

    const receipt = await runMaterialCommand(manager, {
      action: "receive",
      orderId,
      supplierId: IDS.supplierQinghe,
      materialId: material.materialId,
      locationId: IDS.warehouse,
      colorName: "本色",
      qty: "40",
      reference: "GATE-RECEIPT-40",
      occurredOn: "2026-09-20",
      basis: "门槛收料",
      idempotencyKey: "gate-receipt-40",
    });
    const receiptView = await getMaterialReceipt(manager, receipt.id);
    await transferInventory({
      ...manager,
      lotId: receiptView.lotId,
      qty: "20",
      toLocationId: IDS.factoryYunshan,
      idempotencyKey: "gate-transfer-20",
    });

    const before = await getProductionGate(IDS.orgDemo, orderId);
    expect(before.ready).toBe(true);
    expect(before.alreadyReleased).toBe(false);
    expect(before.checks.every((item) => item.passed)).toBe(true);

    await expect(
      releaseToProduction({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId,
      }),
    ).rejects.toThrow(/无权/);

    const released = await releaseToProduction({ ...manager, orderId });
    expect(released.productionReadiness).toBe("ready_for_production");
    expect(released.reused).toBe(false);

    const again = await releaseToProduction({ ...manager, orderId });
    expect(again.reused).toBe(true);

    const qty = await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId,
      kind: "started",
      quantity: 2,
      lines: [{ colorName: "海军蓝", sizeCode: "S", quantity: 2 }],
      idempotencyKey: "gate-started-2",
    });
    expect(qty.record.quantity).toBe(2);
    expect(qty.record.kind).toBe("started");
  });
});
