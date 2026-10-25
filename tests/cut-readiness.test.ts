import { describe, expect, it } from "vitest";
import { evaluateCutSupply, type CutLot, type CutPlanLine } from "@/server/domain/cut-readiness";

const fabric: CutPlanLine = {
  materialId: "mat-1",
  materialCode: "MAT-1",
  materialName: "棉毛布",
  unit: "m",
  gross: "80",
  status: "calculated",
};

function lot(input: Partial<CutLot> & Pick<CutLot, "locationId" | "locationKind" | "qtyOnHand">): CutLot {
  return {
    materialId: "mat-1",
    qtyAllocated: "0",
    allocatedToOrder: "0",
    consumedOnOrder: "0",
    qualityStatus: "qualified",
    ownerKind: "company",
    ...input,
  };
}

describe("开裁料况", () => {
  it("单耗未确认时不能判断开裁", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [{ ...fabric, gross: null, status: "pending_consumption" }],
      lots: [],
    });
    expect(result.status).toBe("unknown");
    expect(result.canCut).toBe(false);
    expect(result.label).toContain("单耗未确认");
    expect(result.blockers).toContain("单耗未确认");
  });

  it("公司有料但还在原料库，算未调到厂，不能开裁", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [fabric],
      lots: [lot({ locationId: "wh-1", locationKind: "warehouse", qtyOnHand: "100" })],
    });
    expect(result.status).toBe("blocked");
    expect(result.canCut).toBe(false);
    expect(result.blockers).toEqual(["未调到厂"]);
    expect(result.lines[0]).toMatchObject({
      companyOnHand: "100",
      atFactory: "0",
      remaining: "80",
    });
  });

  it("公司和厂都没有可用料，算未到料", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [fabric],
      lots: [],
    });
    expect(result.blockers).toEqual(["未到料"]);
    expect(result.label).toBe("未到料");
  });

  it("厂里可用量盖住剩余毛需求，才可开裁", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [fabric],
      lots: [lot({ locationId: "factory-1", locationKind: "factory", qtyOnHand: "80" })],
    });
    expect(result.status).toBe("ready");
    expect(result.canCut).toBe(true);
    expect(result.label).toBe("可开裁");
    expect(result.blockers).toEqual([]);
  });

  it("已领满毛需求也可开裁，调拨不计入领用", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [fabric],
      lots: [
        lot({ locationId: "factory-1", locationKind: "factory", qtyOnHand: "20", consumedOnOrder: "80" }),
      ],
    });
    expect(result.canCut).toBe(true);
    expect(result.lines[0].consumed).toBe("80");
    expect(result.lines[0].remaining).toBe("0");
  });

  it("未开裁且本单没有面辅料时，不能当成料况未知", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: false,
      lines: [],
      lots: [],
    });
    expect(result.canCut).toBe(false);
    expect(result.label).toBe("本单草稿没有面辅料");
    expect(result.blockers).toEqual(["本单草稿没有面辅料"]);
  });

  it("已经开裁但没有本单BOM时，仍记已开裁，不卡面料", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: true,
      lines: [],
      lots: [],
    });
    expect(result.label).toBe("已开裁");
    expect(result.blockers).toEqual([]);
  });

  it("已经开裁的历史单不把缺领用记成卡面料", () => {
    const result = evaluateCutSupply({
      factoryId: "factory-1",
      started: true,
      lines: [fabric],
      lots: [lot({ locationId: "wh-1", locationKind: "warehouse", qtyOnHand: "10" })],
    });
    expect(result.status).toBe("ready");
    expect(result.label).toBe("已开裁");
    expect(result.blockers).toEqual([]);
  });
});
