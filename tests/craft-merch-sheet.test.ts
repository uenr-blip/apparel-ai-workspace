import { describe, expect, it } from "vitest";
import { normalizePatternSheet, readPatternSheet } from "@/server/domain/craft-sheet";
import {
  buildSeasonBoard,
  emptyBulk,
  emptySalesSample,
  normalizeMerchOrder,
  normalizeMerchSheet,
  progressSentence,
  purchaseLines,
  readBulk,
} from "@/server/domain/merch-sheet";

describe("版单", () => {
  it("毛衣记下纱线字段", () => {
    const saved = normalizePatternSheet({
      craftFamily: "sweater",
      origin: "copy_garment",
      sweater: { yarnComposition: "100% wool", yarnCount: "2/48", inStock: "yes", customYarnPrice: "12" },
      fabric: { fabricComposition: "先留着" },
    });
    const read = readPatternSheet(saved.craftFamily, saved.sheetJson);
    expect(saved.craftFamily).toBe("sweater");
    expect(read.origin).toBe("copy_garment");
    expect(read.sweater.yarnCount).toBe("2/48");
    expect(read.sweater.inStock).toBe("yes");
    expect(read.fabric.fabricComposition).toBe("先留着");
  });

  it("没选类型不能保存", () => {
    expect(() => normalizePatternSheet({ craftFamily: "" })).toThrow(/毛衣/);
  });
});

describe("销售样和大货", () => {
  it("不下不计入要买数量，工价不进采购表", () => {
    const lines = purchaseLines(
      {
        ...emptySalesSample(),
        composition: "100% cotton",
        shellConsumption: "1.25",
        shellPrice: "40.21",
        laborPrice: "18",
      },
      {
        ...emptyBulk(),
        colors: [
          { guestColor: "咖啡色", factoryColorName: "", qtyText: "不下", metalBadge: "" },
          { guestColor: "浅黄", factoryColorName: "淡黄", qtyText: "200", metalBadge: "金色" },
          { guestColor: "黑", factoryColorName: "", qtyText: "300", metalBadge: "枪色" },
        ],
      },
    );
    expect(lines[0]).toMatchObject({ name: "100% cotton", buyQty: "625" });
    expect(lines[0]?.note).toContain("不下");
    expect(lines.some((row) => row.price === "18")).toBe(false);
  });

  it("大货缺数量不能借用销售样数量，销售样独立计算", () => {
    const lines = purchaseLines(
      { ...emptySalesSample(), shellConsumption: "2", shellPrice: "10", salesSample: "34 / 6.04空运" },
      emptyBulk(),
    );
    expect(lines[0]?.buyQty).toBe("");
    expect(purchaseLines({ ...emptySalesSample(), shellConsumption: "2", salesSample: "34 / 6.04空运" }, emptyBulk(), "sales_sample")[0]?.buyQty).toBe("68");
  });

  it("颜色都写下不，要买数量是 0", () => {
    const lines = purchaseLines(
      { ...emptySalesSample(), shellConsumption: "1", shellPrice: "8" },
      { ...emptyBulk(), colors: [{ guestColor: "黑", factoryColorName: "", qtyText: "不下", metalBadge: "" }] },
    );
    expect(lines[0]?.buyQty).toBe("0");
  });

  it("同一款只数一次，工厂下面挂款", () => {
    const board = buildSeasonBoard([
      {
        orderId: "1",
        orderNo: "A",
        styleCode: "ST1",
        styleName: "背心",
        imagePath: "",
        factoryName: "研色",
        seasonCode: "SS27",
        craftFamily: "knit",
        salesSample: emptySalesSample(),
        bulk: emptyBulk(),
      },
      {
        orderId: "2",
        orderNo: "B",
        styleCode: "ST1",
        styleName: "背心",
        imagePath: "",
        factoryName: "研色",
        seasonCode: "SS27",
        craftFamily: "woven",
        salesSample: emptySalesSample(),
        bulk: emptyBulk(),
      },
      {
        orderId: "3",
        orderNo: "C",
        styleCode: "ST2",
        styleName: "毛衣",
        imagePath: "",
        factoryName: "达成",
        seasonCode: "SS27",
        craftFamily: "sweater",
        salesSample: { ...emptySalesSample(), progress: "已包完" },
        bulk: emptyBulk(),
      },
    ]);
    expect(board.counts).toEqual({ sweater: 1, knit: 1, woven: 0, unset: 0 });
    expect(board.factories.find((row) => row.name === "研色")?.styles).toEqual(["ST1 背心"]);
    expect(board.rows[2]?.progress).toBe("已包完");
  });

  it("一单可以放下两个款，空款不保存", () => {
    const saved = normalizeMerchOrder({
      seasonCode: "SS27",
      styles: [
        { styleCode: "A", styleName: "衬衫", craftFamily: "woven", bulk: { colors: [{ guestColor: "黑", qtyText: "不下" }] } },
        { styleCode: "B", styleName: "毛衣", craftFamily: "sweater" },
        { styleCode: "", styleName: "", craftFamily: "" },
      ],
    });
    expect(saved.styles.map((style) => style.styleCode)).toEqual(["A", "B"]);
    expect(saved.styles[0]?.bulk.colors[0]?.qtyText).toBe("不下");
  });

  it("保存时保留不下", () => {
    const saved = normalizeMerchSheet({
      craftFamily: "woven",
      bulk: { colors: [{ guestColor: "黑", qtyText: "不下", factoryColorName: "", metalBadge: "" }] },
    });
    expect(readBulk(saved.bulkJson).colors[0]?.qtyText).toBe("不下");
  });

  it("其他辅料按她的写法保留换行", () => {
    const note = "吊牌：HTS\n主唛：P-ML\n尺码唛：白+浅黄用白色\n黑色用黑色";
    const saved = normalizeMerchSheet({
      craftFamily: "woven",
      bulk: { otherTrim: note, colors: [{ guestColor: "本白", qtyText: "20" }] },
    });
    expect(readBulk(saved.bulkJson).otherTrim).toBe(note);
  });

  it("进度按面料、扣子、拉链分开，打色记下客人确认", () => {
    const saved = normalizeMerchOrder({
      styles: [
        {
          styleCode: "A",
          imagePath: "/api/sheet-images/abcd1234",
          labDip: {
            fabricColors: [{ name: "驼", guest: "yes" }],
            trimColors: [{ name: "拉链", guest: "pending" }],
          },
          bulk: { progress: "已包完", fabricProgress: "布在染", buttonProgress: "扣子还没到", zipperProgress: "拉链确认了" },
        },
        { imagePath: "http://evil.example/a.png", styleCode: "B" },
      ],
    });
    expect(saved.styles[0]?.imagePath).toBe("/api/sheet-images/abcd1234");
    expect(saved.styles[0]?.labDip.fabricColors[0]).toEqual({ name: "驼", guest: "yes" });
    expect(saved.styles[0]?.labDip.trimColors.find((row) => row.name === "拉链")?.guest).toBe("pending");
    expect(progressSentence(saved.styles[0]!.bulk)).toBe("已包完；面料：布在染；扣子：扣子还没到；拉链：拉链确认了");
    expect(saved.styles[1]?.imagePath).toBe("");
  });

  it("辅料格可以贴图，外来地址不收", () => {
    const saved = normalizeMerchOrder({
      styles: [
        {
          styleCode: "A",
          salesSample: {
            mainLabel: "P-ML",
            pictures: {
              mainLabel: ["/api/sheet-images/abcd1234", "http://evil.example/a.png"],
              hangtag: ["/api/sheet-images/abcd1234"],
            },
          },
        },
      ],
    });
    expect(saved.styles[0]?.salesSample.mainLabel).toBe("P-ML");
    expect(saved.styles[0]?.salesSample.pictures.mainLabel).toEqual(["/api/sheet-images/abcd1234"]);
    expect(saved.styles[0]?.salesSample.pictures.hangtag).toEqual(["/api/sheet-images/abcd1234"]);
    expect(saved.styles[0]?.salesSample.pictures.note).toEqual([]);
  });
});
