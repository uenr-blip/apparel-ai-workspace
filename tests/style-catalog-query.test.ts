import { describe, expect, it } from "vitest";
import { filterStyleCatalog, parseStyleLayout, styleCatalogHref } from "@/lib/style-catalog-query";

const rows = [
  { code: "ST-26018", orderPos: [{ orderNo: "DEMO-ORD-001", po: "NB-1" }] },
  { code: "ST-26009", orderPos: [] },
];

describe("款式列表找款号", () => {
  it("默认卡片认款；列表可切换，检索不丢是否有单", () => {
    expect(parseStyleLayout(undefined)).toBe("cards");
    expect(styleCatalogHref({}, "")).toBe("/styles");
    expect(styleCatalogHref({ layout: "list", ordered: "open" }, "ST-26009")).toBe(
      "/styles?layout=list&ordered=open&q=ST-26009",
    );
  });

  it("可按是否已接单收窄", () => {
    expect(filterStyleCatalog(rows, "ordered").map((row) => row.code)).toEqual(["ST-26018"]);
    expect(filterStyleCatalog(rows, "open").map((row) => row.code)).toEqual(["ST-26009"]);
  });
});
