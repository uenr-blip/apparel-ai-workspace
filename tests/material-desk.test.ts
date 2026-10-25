import { describe, expect, it } from "vitest";
import { materialDeskCopy } from "@/server/domain/material-desk";

describe("本单料况文案", () => {
  it("草稿没有面辅料、比较用已批准资料时，不再写成料况未知", () => {
    const copy = materialDeskCopy({
      supplyLabel: "料况未知",
      supplyFacts: ["料况未知", "开裁看厂里可用料和已领用，调拨到厂不是领用。"],
      planFacts: ["无面辅料，不能算毛需求"],
      purchaseFacts: [
        "已采用方案 B，采购草稿 1350 米，未下达采购",
        "本单当前资料草稿无面辅料，比较按该款已批准资料计算",
      ],
      supplyLineCount: 0,
      purchaseLineCount: 1,
    });
    expect(copy.supplyLabel).toBeNull();
    expect(copy.emptyNote).toContain("开裁还不能按这份草稿判断");
    expect(copy.facts.join(" ")).not.toContain("料况未知");
    expect(copy.facts.join(" ")).not.toContain("无面辅料，不能算毛需求");
    expect(copy.facts).toContain("已采用方案 B，采购草稿 1350 米，未下达采购");
    expect(copy.facts).toContain("开裁看厂里可用料和已领用，调拨到厂不是领用。");
  });

  it("草稿和比较都没有料时，仍写还不能判断", () => {
    const copy = materialDeskCopy({
      supplyLabel: "料况未知",
      supplyFacts: ["还没有可判断的面辅料需求"],
      planFacts: ["无面辅料，不能算毛需求"],
      purchaseFacts: [],
      supplyLineCount: 0,
      purchaseLineCount: 0,
    });
    expect(copy.supplyLabel).toBe("料况未知");
    expect(copy.emptyNote).toBe("还没有可判断的面辅料需求。");
    expect(copy.facts).toContain("无面辅料，不能算毛需求");
  });

  it("本单草稿已有料况时，保留开裁结论", () => {
    const copy = materialDeskCopy({
      supplyLabel: "未到料",
      supplyFacts: ["未到料，不能开裁"],
      planFacts: ["毛需求 MAT-001 1545 m（规则计算，未扣库存，不是采购建议）"],
      purchaseFacts: ["未下达采购"],
      supplyLineCount: 1,
      purchaseLineCount: 1,
    });
    expect(copy.supplyLabel).toBe("未到料");
    expect(copy.emptyNote).toBeNull();
    expect(copy.facts).toContain("未到料，不能开裁");
  });
});
