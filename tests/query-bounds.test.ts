import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getPurchaseOptions } from "@/server/services/purchase-options";
import { resetDatabase } from "./helpers";

describe("采购比较查询规模", () => {
  it("BOM从1种材料增加到21种时不逐行增加数据库查询", async () => {
    await resetDatabase();
    const measured = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let queries = 0;
    measured.$on("query", event => { if (/^SELECT/i.test(event.query)) queries++; });
    try {
      await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage, measured);
      const single = queries;
      const ids = Array.from({ length: 20 }, (_, i) => `perf-material-${i}`);
      await prisma.material.createMany({ data: ids.map(id => ({
        id, organizationId: IDS.orgDemo, code: id, name: id, kind: "fabric", specSummary: "测试", unit: "m", demoNote: "虚构性能数据",
      })) });
      await prisma.bomLine.createMany({ data: ids.map(id => ({
        id: `bom-${id}`, styleVersionId: "version-ST-26001-v1", materialId: id, consumption: "1", unit: "m", confirmed: true,
      })) });
      await prisma.supplierQuote.createMany({ data: ids.map(id => ({
        id: `quote-${id}`, organizationId: IDS.orgDemo, supplierId: IDS.supplierQinghe, materialId: id,
        unit: "m", unitPriceMinor: 2000, moq: "10", multiple: "10", validFrom: "2026-09-01", demoNote: "虚构性能数据",
      })) });
      queries = 0;
      const expanded = await getPurchaseOptions(IDS.orgDemo, IDS.orderShortage, measured);
      expect(expanded.lines).toHaveLength(21);
      expect(queries).toBeLessThanOrEqual(single + 1);
      console.log(JSON.stringify({ purchaseQueryCounts: { oneMaterial: single, twentyOneMaterials: queries } }));
    } finally {
      await measured.$disconnect();
    }
  });
});
