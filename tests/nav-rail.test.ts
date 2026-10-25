import { describe, expect, it } from "vitest";
import { navCollapsedFromStorage, serverSafeNavCollapsed } from "@/lib/nav";

describe("侧栏折叠", () => {
  it("首屏默认展开，避免读 localStorage 造成水合不一致", () => {
    expect(serverSafeNavCollapsed()).toBe(false);
    expect(navCollapsedFromStorage(null)).toBe(false);
    expect(navCollapsedFromStorage("0")).toBe(false);
  });

  it("只把明确的 1 当成已折叠", () => {
    expect(navCollapsedFromStorage("1")).toBe(true);
  });
});
