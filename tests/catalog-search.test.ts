import { describe, expect, it } from "vitest";
import { buildCatalogHref, catalogQuery, matchesCatalogQuery } from "@/lib/catalog-query";

describe("大批量列表检索", () => {
  it("空关键词不过滤；款号、订单号、PO 可命中，大小写不敏感", () => {
    expect(catalogQuery("  ST-26018  ")).toBe("ST-26018");
    expect(matchesCatalogQuery("", ["DEMO-ORD-091"])).toBe(true);
    expect(matchesCatalogQuery("st-26018", ["ST-26018", "圆领针织上衣"])).toBe(true);
    expect(matchesCatalogQuery("DEMO-ORD-005", ["DEMO-ORD-001", "ST-26018"])).toBe(false);
    expect(matchesCatalogQuery("nb-po", ["NB-PO-2025-088"])).toBe(true);
    expect(buildCatalogHref("/delivery", { view: "fabric" }, "  DEMO  ")).toBe("/delivery?view=fabric&q=DEMO");
    expect(buildCatalogHref("/delivery", {}, "")).toBe("/delivery");
    expect(buildCatalogHref("/decisions", { status: "preview" }, "")).toBe("/decisions?status=preview");
  });
});
