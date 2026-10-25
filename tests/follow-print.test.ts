import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { followPrintContent } from "@/lib/follow-print";
import { BulkMasterPrint } from "@/app/(app)/orders/bulk-master-print";
import { masterCounts, standardMasterColumns } from "@/lib/follow-master";
import type { FollowStyleLine } from "@/server/services/order-merch";

const long = "吊牌：HTS\n主唛：P-ML 字母尺码唛-白色\n洗唛：本白+浅黄色用白色洗唛\n其他颜色用灰色\n不需要空白唛和说明唛\n1CM方形金属标";
const line = {
  key: "s:1", href: "/orders/follow/s?row=0", styleHref: "/styles/s1", factoryName: "达成", styleName: "Sweatshirt", styleCode: "ST-1", numericCode: "00186700", po: "PO100519", seasonCode: "SS27", imageSrc: "", orderNo: "", purchaseDate: "2026-09-09", shipDate: "2026-10-31", inboundDate: "2026-11-07", otherTrim: "本款通用要求", button: "", zipper: "", hook: "", composition: "棉", gsm: "", shellWidth: "", shellConsumption: "", materialSummary: "", progress: "待回色卡", productionHref: "", shipmentDates: [],
  colors: ["Yellow", "Rose", "Navy"].map((name, i) => ({ guestColor: name, factoryColorName: "厂色" + i, qtyText: ["701", "350", "不下"][i], metalBadge: "银色", colorTrims: { mainLabel: "P-ML", otherTrim: long } })),
} as FollowStyleLine;

describe("省纸打印，不改变跟单数据", () => {
  it("按字段将相同长说明合并一次，保留原文和全部适用颜色，不截断内容", () => {
    const before = JSON.stringify(line), result = followPrintContent(line, standardMasterColumns);
    expect(result.notes).toEqual([{ number: 1, label: "每色其他辅料", text: long, rows: [1, 2, 3], allColors: true }]);
    expect(result.rows.every(row => row.trims.some(v => v.reference === 1))).toBe(true);
    expect(result.rows.map(row => row.quantity)).toEqual(["701", "350", "不下"]);
    expect(masterCounts([line]).quantity).toBe(1051);
    expect(JSON.stringify(line)).toBe(before);
  });
  it("不同颜色说明分别编号，缺填保持缺填，隐藏资料不进入说明", () => {
    const mixed = { ...line, colors: line.colors.map((c, i) => ({ ...c, colorTrims: { ...c.colorTrims, otherTrim: i === 1 ? long + "\n换成金色" : i === 2 ? "" : long } })) };
    const result = followPrintContent(mixed, standardMasterColumns);
    expect(result.notes.map(n => [n.rows, n.allColors])).toEqual([[[1], false], [[2], false]]);
    expect(result.notes[1].text).toContain("换成金色");
    expect(result.rows[2].trims.some(v => v.label === "每色其他辅料")).toBe(false);
    const selected = followPrintContent(mixed, ["labels"]);
    expect(selected.notes).toHaveLength(0); expect(selected.details).toHaveLength(0);
  });
  it("打印结构不使用跨行合并，页头保留批次身份；长说明只出现一次且可回原单", () => {
    const html = renderToStaticMarkup(createElement(BulkMasterPrint, { name: "达成", lines: [line], columns: standardMasterColumns }));
    expect(html).not.toMatch(/rowspan/i);
    expect(html).toContain('class="print-style-heading"'); expect(html).toContain("00186700"); expect(html).toContain("PO100519");
    expect(html).toContain("2026-09-09"); expect(html).toContain("2026-10-31"); expect(html).toContain("2026-11-07");
    expect(html.split("其他颜色用灰色")).toHaveLength(2);
    expect(html).toContain("本表全部颜色"); expect(html).toContain('/orders/follow/s?row=0#follow-color-trims');
    expect(html).toContain("不下"); expect(html).toContain("本款通用要求");
  });
});
