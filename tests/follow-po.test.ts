import { describe, expect, it } from "vitest";
import { normalizeMerchOrder, readBulk } from "@/server/domain/merch-sheet";
import { customerPo, productionPoFacts, validateFollowPo } from "@/server/domain/follow-po";

const row = (po = "PO100519", productCode = "00186700") => ({ styleCode: "ST-TEST", salesSample: { numericCode: productCode, po: "SAMPLE-OLD" }, bulk: { po, purchaseDate: "2026-09-09", shipDate: "2026-11-20", colors: [{ guestColor: "00152 True Camel", qtyText: "850" }] } });

describe("客户 PO / 产品编号 / 采购日期", () => {
  it("老表补空日期，不把旧订单号或销售样 PO 猜为大货 PO", () => {
    expect(readBulk('{"orderNo":"DEMO-ORD-001"}')).toMatchObject({ orderNo: "DEMO-ORD-001", po: "", purchaseDate: "" });
    const [style] = normalizeMerchOrder({ styles: [row("")] }).styles;
    expect(customerPo(style, "bulk")).toBe("");
    expect(customerPo(style, "sales_sample")).toBe("SAMPLE-OLD");
    expect(style.salesSample.numericCode).toBe("00186700");
  });
  it("采购日期校验真实年月日，同 PO 日期矛盾不能保存", () => {
    for (const value of ["2026-02-30", "2026-13-01", "9.9", "2026-9-9"]) {
      const data = row(); data.bulk.purchaseDate = value;
      expect(() => validateFollowPo(normalizeMerchOrder({ styles: [data] }).styles, "bulk")).toThrow(/采购日期/);
    }
    const other = row(); other.bulk.purchaseDate = "2026-09-10";
    expect(() => validateFollowPo(normalizeMerchOrder({ styles: [row(), other] }).styles, "bulk")).toThrow(/不一致/);
  });
  it("同款多 PO 沿用产品编号；不同编号或不同产品误用同号被拦截", () => {
    expect(() => validateFollowPo(normalizeMerchOrder({ styles: [row(), row("PO100520")] }).styles, "bulk")).not.toThrow();
    expect(() => validateFollowPo(normalizeMerchOrder({ styles: [row(), row("PO100520", "123")] }).styles, "bulk")).toThrow(/产品编号不一致/);
    expect(() => validateFollowPo(normalizeMerchOrder({ styles: [row(), { ...row(), styleCode: "OTHER" }] }).styles, "bulk")).toThrow(/不同款式/);
  });
  it("多 PO 或有号/缺号混合不能开成一单，完整 PO 带出原始要求", () => {
    for (const po of ["PO100520", ""]) expect(() => productionPoFacts(normalizeMerchOrder({ styles: [row(), row(po)] }).styles, "bulk")).toThrow(/分成跟单/);
    expect(productionPoFacts(normalizeMerchOrder({ styles: [row()] }).styles, "bulk")).toEqual({ po: "PO100519", purchaseDate: "2026-09-09", requestedShipDate: "2026-11-20" });
  });
});
