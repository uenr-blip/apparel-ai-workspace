import { describe, expect, it } from "vitest";
import {
  filterMaterialShelf,
  materialShelfHref,
  parseMaterialLayout,
  sortMaterialShelfForFind,
} from "@/lib/material-shelf-query";

const rows = [
  { code: "MAT-010", kind: "trim", usedByStyleCodes: [], usedByProjectCodes: [] },
  { code: "MAT-001", kind: "fabric", usedByStyleCodes: ["ST-26018"], usedByProjectCodes: [] },
  { code: "MAT-004", kind: "trim", usedByStyleCodes: [], usedByProjectCodes: ["DEV-001"] },
];

describe("面辅料库找料", () => {
  it("默认卡片认材料，可切回列表；检索不丢显示方式、种类和挂款", () => {
    expect(parseMaterialLayout(undefined)).toBe("cards");
    expect(parseMaterialLayout("cards")).toBe("cards");
    expect(parseMaterialLayout("list")).toBe("list");
    expect(materialShelfHref({}, "")).toBe("/styles?tab=materials");
    expect(materialShelfHref({ kind: "trim", layout: "cards", used: "free" }, "树脂")).toBe(
      "/styles?tab=materials&kind=trim&used=free&q=%E6%A0%91%E8%84%82",
    );
    expect(materialShelfHref({ kind: "yarn", layout: "list", used: "used" }, "羊毛")).toBe("/styles?tab=materials&kind=yarn&layout=list&used=used&q=%E7%BE%8A%E6%AF%9B");
  });

  it("可按辅料和是否已挂款收窄，列表按货号排", () => {
    expect(filterMaterialShelf(rows, { kind: "trim" }).map((row) => row.code)).toEqual(["MAT-010", "MAT-004"]);
    expect(filterMaterialShelf(rows, { used: "used" }).map((row) => row.code)).toEqual(["MAT-001", "MAT-004"]);
    expect(filterMaterialShelf(rows, { kind: "trim", used: "free" }).map((row) => row.code)).toEqual(["MAT-010"]);
    expect(sortMaterialShelfForFind(rows).map((row) => row.code)).toEqual(["MAT-001", "MAT-004", "MAT-010"]);
  });
});
