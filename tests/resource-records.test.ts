import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { getLotRecord, getPartyRecord, getQuoteRecord, ResourceRecordError } from "@/server/services/resource-records";
import { resetDatabase } from "./helpers";

describe("资源中心往来/批次/报价详情", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("工厂、原料库、供应商各自列出地点批次或报价，不是新菜单", async () => {
    const factory = await getPartyRecord(IDS.orgDemo, IDS.factoryYunshan);
    expect(factory.name).toBe("云杉服装工厂");
    expect(factory.kind).toBe("factory");
    expect(factory.orderNos).toContain("DEMO-ORD-001");
    expect(factory.navMenus).toEqual([]);

    const warehouse = await getPartyRecord(IDS.orgDemo, IDS.warehouse);
    expect(warehouse.kind).toBe("warehouse");
    expect(warehouse.lots.some((lot) => lot.materialCode === "MAT-D06")).toBe(true);
    expect(warehouse.quotes).toEqual([]);

    const supplier = await getPartyRecord(IDS.orgDemo, IDS.supplierQinghe);
    expect(supplier.quotes.some((quote) => quote.materialCode === "MAT-001")).toBe(true);
    expect(supplier.lots.length).toBeGreaterThan(0);
  });

  it("批次和报价能定位到材料和地点，报价不是已采购", async () => {
    const lot = await getLotRecord(IDS.orgDemo, "lot-mat001-oh");
    expect(lot.materialCode).toBe("MAT-001");
    expect(lot.locationName).toBe("青禾面料");
    expect(Number(lot.qtyOnHand)).toBeGreaterThan(0);

    const inbound = await getLotRecord(IDS.orgDemo, "lot-mat001-inb");
    expect(inbound.inboundEta).toBeTruthy();

    const quote = await getQuoteRecord(IDS.orgDemo, "quote-mat001");
    expect(quote.unitPriceYuan).toBe("20.00");
    expect(quote.facts.join(" ")).toContain("不是已采购");
    expect(quote.issued).toBe(false);
  });

  it("外组织读不到演示往来或批次", async () => {
    await expect(getPartyRecord(IDS.orgIso, IDS.factoryYunshan)).rejects.toBeInstanceOf(ResourceRecordError);
    await expect(getLotRecord(IDS.orgIso, "lot-mat001-oh")).rejects.toBeInstanceOf(ResourceRecordError);
    await expect(getQuoteRecord(IDS.orgIso, "quote-mat001")).rejects.toBeInstanceOf(ResourceRecordError);
  });
});
