import { describe, expect, it } from "vitest";
import { suggestedDeliveryDate } from "@/lib/delivery-year";

describe("交期年份推断", () => {
  it("原文只有月日时用演示参考年拼出建议日期，不是原文事实", () => {
    expect(suggestedDeliveryDate("10月20日", 2026)).toBe("2026-10-20");
    expect(suggestedDeliveryDate("10 月 20 日", 2026)).toBe("2026-10-20");
    expect(suggestedDeliveryDate("20 October", 2026)).toBe("2026-10-20");
    expect(suggestedDeliveryDate("October 20", 2026)).toBe("2026-10-20");
  });

  it("没有月日就不编造", () => {
    expect(suggestedDeliveryDate(null)).toBeNull();
    expect(suggestedDeliveryDate("尽快交货")).toBeNull();
  });
});
