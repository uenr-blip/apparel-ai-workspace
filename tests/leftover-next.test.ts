import { describe, expect, it } from "vitest";
import { leftoverNextStep } from "@/server/domain/leftover-next";

describe("余料下一步", () => {
  it("规格可比较且有可分配余料时，默认采用方案 A", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: true,
      freeStock: "120",
      adopted: null,
    });
    expect(next.kind).toBe("ready");
    expect(next.recommend).toBe("A");
    expect(next.blockers).toEqual(["余料未占"]);
    expect(next.label).toContain("方案 A");
  });

  it("没有可占余料时，默认确认补购，不编效益", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: true,
      freeStock: "0",
      adopted: null,
    });
    expect(next.recommend).toBe("B");
    expect(next.label).toContain("方案 B");
    expect(next.label).not.toContain("利润");
  });

  it("还不能比较时不催采用", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: false,
      freeStock: "0",
      adopted: null,
    });
    expect(next.kind).toBe("blocked");
    expect(next.recommend).toBeNull();
    expect(next.blockers).toEqual([]);
  });

  it("采用后只说已占住，不下采购", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: true,
      freeStock: "0",
      adopted: { optionCode: "A", status: "draft" },
    });
    expect(next.kind).toBe("adopted");
    expect(next.blockers).toEqual([]);
    expect(next.label).toContain("余料已占住（方案 A）");
    expect(next.label).toContain("未下达采购");
  });

  it("采用方案 B 只写采购草稿，不写成余料已占住", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: true,
      freeStock: "120",
      adopted: { optionCode: "B", status: "draft" },
    });
    expect(next.kind).toBe("adopted");
    expect(next.label).toBe("已采用方案 B，采购草稿，未下达采购");
  });

  it("过期方案必须重采用", () => {
    const next = leftoverNextStep({
      started: false,
      comparable: true,
      freeStock: "80",
      adopted: { optionCode: "A", status: "stale" },
    });
    expect(next.kind).toBe("stale");
    expect(next.blockers).toEqual(["余料方案过期"]);
    expect(next.recommend).toBe("A");
  });
});
