import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { masterCounts, parseMasterColumns } from "@/lib/follow-master";
import { filterFollowProducts } from "@/lib/follow-search";
import { readBulk } from "@/server/domain/merch-sheet";
import { BulkMasterBoard } from "@/app/(app)/orders/bulk-master-board";
import type { FollowStyleLine } from "@/server/services/order-merch";

const makeLine = (po: string, qty: string, index: number) => ({
  key: `sheet:${index}`, href: `/orders/follow/sheet?row=${index}`, seasonCode: "SS27", factoryName: "达成", numericCode: "166610", styleCode: "ST-1", styleName: "MMPhoebe Miley Blazer", po, purchaseDate: "2026-09-09", shipDate: "2026-10-31", inboundDate: "", productionOrderNo: "", productionHref: "", productionProgress: "", shipmentDates: [], materialSummary: "", composition: "65% 涤 35% GRS 涤", gsm: "", shellWidth: "", shellConsumption: "", orderNo: "", imageSrc: "", styleHref: "/styles/style-1", otherTrim: "", progress: "待回色卡", button: "", zipper: "", hook: "", sampleColors: "", sheetTitle: "SS27",
  colors: [{ guestColor: "205 Pastel Yellow", factoryColorName: "浅黄色", qtyText: qty, metalBadge: "圆形银色", colorTrims: { mainLabel: "P-MLL", careSizeLabel: "白色洗唛+白色尺码唛" } }],
} as FollowStyleLine);
describe("工厂大货总表", () => {
  it("同产品两批不重复算款数，分别计数量；不下和缺数保留区别", () => {
    const lines = [makeLine("PO100161", "450", 0), makeLine("PO100515", "150", 1), makeLine("PO100515", "不下", 2), makeLine("PO100515", "", 3)];
    expect(masterCounts(lines)).toEqual({ products: 1, pos: 2, quantity: 600, colorRows: 3, missingQuantity: 1 });
  });
  it("按每色唛标可检索，同 PO 颜色资料不丢失，空颜色先写辅料也保留", () => {
    const lists = { sales: [], bulk: [{ factoryName: "达成", styles: [makeLine("PO100515", "150", 1)] }], emptySheets: [] };
    expect(filterFollowProducts(lists, "白色洗唛").bulk).toHaveLength(1);
    expect(readBulk(JSON.stringify({ colors: [{ colorTrims: { careSizeLabel: "白色洗唛" } }] })).colors[0].colorTrims?.careSizeLabel).toBe("白色洗唛");
  });
  it("总表图片去款式；元素链接选中对应款；打印保留筛选和指定列", () => {
    const lists = { sales: [], bulk: [{ factoryName: "达成", styles: [makeLine("PO100515", "150", 1)] }, { factoryName: "另一厂", styles: [makeLine("PO-OTHER", "100", 2)] }], emptySheets: [] };
    const markup = renderToStaticMarkup(createElement(BulkMasterBoard, { lists, printMode: true, initial: { season: "SS27", factory: "达成", columns: "labels" } }));
    expect(markup).toContain("白色洗唛+白色尺码唛");
    expect(markup).toContain('/orders/follow/sheet?row=1#follow-color-trims');
    expect(markup).toContain('/styles/style-1');
    expect(markup).not.toContain("PO-OTHER");
    expect(markup).not.toContain("面料成分 / 规格 / 单耗");
    expect(parseMasterColumns("labels,evil")).toEqual(["labels"]);
    expect(parseMasterColumns("")).toEqual([]);
  });
});
