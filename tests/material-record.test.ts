import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { getMaterialRecord } from "@/server/services/material-record";
import { resetDatabase } from "./helpers";

describe("材料详情主档", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("MAT-001 列出主档、批次地点、报价和用在哪款，不把主档当成库存菜单", async () => {
    const record = await getMaterialRecord(IDS.orgDemo, IDS.materialMat001);
    expect(record.code).toBe("MAT-001");
    expect(record.specSummary).toContain("海军蓝");
    expect(record.facts.join(" ")).toContain("主档不是库存");
    expect(record.lots.length).toBeGreaterThan(0);
    expect(record.lots.some((lot) => lot.locationName && Number(lot.qtyOnHand) > 0)).toBe(true);
    expect(record.quotes.length).toBeGreaterThan(0);
    expect(record.usedByStyleCodes).toContain("ST-26018");
    expect(record.navMenus).toEqual([]);
    expect(record).toMatchObject({
      composition: "",
      gsm: "",
      widthCm: "",
      imageSrc: "",
    });
  });

  it("没有批次的材料仍显示主档，空列表写还没有，不假装已采购", async () => {
    const record = await getMaterialRecord(IDS.orgDemo, "material-004");
    expect(record.code).toBe("MAT-004");
    expect(record.name).toBe("演示材料 004");
    expect(record.lots).toEqual([]);
    expect(record.quotes).toEqual([]);
    expect(record.usedByStyleCodes).toEqual([]);
    expect(record.emptyStates).toEqual(expect.arrayContaining(["还没有库存批次", "还没有报价", "还没有被款式引用"]));
    expect(record.facts.join(" ")).toContain("不是已采购");
  });
});
