import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ExecutionError } from "@/server/services/execution";
import { getOrderMaterialPlan } from "@/server/services/material-plan";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { resetDatabase } from "./helpers";

describe("记录口头单耗与本单毛需求", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("DEMO-ORD-001 按 800 件 × 1.5 m × 1.03 算出 1236 m，不扣库存、不给采购建议", async () => {
    const plan = await getOrderMaterialPlan(IDS.orgDemo, IDS.orderHistorical);
    expect(plan.orderNo).toBe("DEMO-ORD-001");
    expect(plan.quantityPieces).toBe(800);
    expect(plan.mode).toBe("rule_calculated");
    expect(plan.stockDeducted).toBe(false);
    expect(plan.purchaseSuggested).toBe(false);
    expect(plan).not.toHaveProperty("netRequirement");
    expect(plan).not.toHaveProperty("suggestedPurchase");
    expect(plan.lines).toEqual([
      expect.objectContaining({
        materialCode: "MAT-001",
        unit: "m",
        consumption: "1.5",
        status: "calculated",
        gross: "1236",
      }),
    ]);
    expect(plan.facts.join(" ")).toContain("毛需求 MAT-001 1236 m");
    expect(plan.facts.join(" ")).toContain("规则计算，未扣库存，不是采购建议");
  });

  it("建档只勾料不填单耗时不能算毛需求；填入口头单耗后按规则算，confirmed 仍为 false", async () => {
    const first = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: "style-st-26009",
      materialIds: [IDS.materialMat001],
    });
    await prisma.orderLine.update({
      where: { id: "line-order-demo-003" },
      data: { styleVersionId: first.versionId },
    });

    const pending = await getOrderMaterialPlan(IDS.orgDemo, "order-demo-003");
    expect(pending.lines[0]?.status).toBe("pending_consumption");
    expect(pending.lines[0]?.gross).toBeNull();
    expect(pending.facts.join(" ")).toContain("单耗未确认，不能算毛需求");
    expect(pending.purchaseSuggested).toBe(false);

    const recorded = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: "style-st-26009",
      materialIds: [IDS.materialMat001],
      consumptions: { [IDS.materialMat001]: "1.5" },
    });
    expect(recorded.message).toContain("口头");
    expect(recorded.message).toContain("未签字");

    const line = await prisma.bomLine.findFirstOrThrow({
      where: { styleVersionId: first.versionId, materialId: IDS.materialMat001 },
    });
    expect(line.consumption).toBe("1.5");
    expect(line.confirmed).toBe(false);

    const thread = await import("@/server/services/style-thread").then((mod) =>
      mod.getStyleThread(IDS.orgDemo, "style-st-26009"),
    );
    const draft = thread.stages.filter((row) => row.kind === "spec_version").at(-1);
    expect(draft?.facts.join(" ")).toContain("口头");
    expect(draft?.facts.join(" ")).toContain("1.5");

    const plan = await getOrderMaterialPlan(IDS.orgDemo, "order-demo-003");
    expect(plan.lines[0]).toMatchObject({
      materialCode: "MAT-001",
      status: "calculated",
      gross: "62",
    });
    expect(plan.facts.join(" ")).toContain("62");
    expect(plan.facts.join(" ")).toContain("不是采购建议");
  });

  it("纱线 kg 标未开通；非法单耗拒绝；工厂仍无权写；外组织读不到本单", async () => {
    const yarn = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      styleId: "style-st-26009",
      materialIds: ["material-yarn-01"],
      consumptions: { "material-yarn-01": "0.2" },
    });
    await prisma.orderLine.update({
      where: { id: "line-order-demo-003" },
      data: { styleVersionId: yarn.versionId },
    });
    const plan = await getOrderMaterialPlan(IDS.orgDemo, "order-demo-003");
    expect(plan.lines[0]?.status).toBe("unsupported_unit");
    expect(plan.lines[0]?.gross).toBeNull();
    expect(plan.facts.join(" ")).toContain("该单位毛需求算法未开通");

    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: "style-st-26009",
        materialIds: [IDS.materialMat001],
        consumptions: { [IDS.materialMat001]: "abc" },
      }),
    ).rejects.toThrow("单耗必须是大于 0 的数字");

    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: "style-st-26009",
        materialIds: [IDS.materialMat001],
        consumptions: { [IDS.materialMat001]: "0" },
      }),
    ).rejects.toThrow("单耗必须是大于 0 的数字");

    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        styleId: "style-st-26009",
        materialIds: [IDS.materialMat001],
        consumptions: { [IDS.materialMat001]: "1.5" },
      }),
    ).rejects.toThrow("无权写入面辅料");

    await expect(getOrderMaterialPlan(IDS.orgIso, IDS.orderHistorical)).rejects.toBeInstanceOf(ExecutionError);
  });
});
