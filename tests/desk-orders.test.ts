import { describe, expect, it } from "vitest";
import { isDeskOrder } from "@/server/domain/desk-orders";

describe("一线台面订单", () => {
  it("默认藏起开发留下的口头草稿，种子单和已采用草稿仍在", () => {
    expect(isDeskOrder({ status: "confirmed", orderNo: "DEMO-ORD-002", hasPurchaseDraft: true })).toBe(true);
    expect(isDeskOrder({ status: "draft", orderNo: "DEMO-ORD-025", hasPurchaseDraft: true })).toBe(true);
    expect(isDeskOrder({ status: "draft", orderNo: "DEMO-ORD-001", hasPurchaseDraft: false })).toBe(true);
    expect(isDeskOrder({ status: "draft", orderNo: "DEMO-ORD-094", hasPurchaseDraft: false })).toBe(false);
    expect(isDeskOrder({ status: "in_production", orderNo: "DEMO-ORD-005", hasPurchaseDraft: false })).toBe(true);
  });
});
