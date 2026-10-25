import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { filterFollowProducts } from "@/lib/follow-search";
import { createFollowSheet, listFollowProducts, openFollowAsOrder, saveFollowSheet, saveOrderMerch } from "@/server/services/order-merch";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { businessTools } from "@/server/agents/business-tools";
import { resolveContext } from "@/server/context/context-service";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
const viewer = { role: actor.role, factoryId: null };
const factoryName = "云杉服装工厂";
const line = (po = "PO100519", product = "00186700") => ({
  styleCode: "ST-26003", styleName: "隔离测试客户 PO", craftFamily: "knit",
  salesSample: { numericCode: product, shellConsumption: "1.5" },
  bulk: { po, purchaseDate: "2026-09-09", shipDate: "2026-11-20", colors: [
    { guestColor: "00152 True Camel", qtyText: "850", colorTrims: { mainLabel: "大号白色主唛", careSizeLabel: "白底黑字" } },
    { guestColor: "00205 Pastel Yellow", qtyText: "1983" },
    { guestColor: "00416 Windsurfer", qtyText: "1600" },
    { guestColor: "灰", qtyText: "不下" },
  ] },
});
async function prepare(key: string, styles: unknown[] = [line()]) {
  const created = await createFollowSheet({ ...actor, kind: "bulk", title: `客户 PO ${key}`, factoryName, idempotencyKey: `create-${key}` });
  const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
  const input = { ...actor, sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), factoryName, styles, idempotencyKey: `save-${key}` };
  const saved = await saveFollowSheet(input);
  return { ...input, expectedUpdatedAt: saved.expectedUpdatedAt };
}
const open = (input: Awaited<ReturnType<typeof prepare>>, key: string) => openFollowAsOrder({ ...input, customerId: IDS.customerNorthshore, idempotencyKey: key });
beforeEach(resetDatabase);

describe("客户 PO 跟单闭环", () => {
  it("按产品编号、颜色、采购日期查回多批次；审计保留修改前后，查询不写业务", async () => {
    const a = await prepare("po-one");
    await prepare("po-two", [line("PO100520")]);
    const orders = await prisma.salesOrder.count();
    const purchases = await prisma.purchaseDraft.count();
    const lists = await listFollowProducts(actor.organizationId, viewer);
    const rows = filterFollowProducts(lists, "00186700", "2026-09-01", "2026-09-30").bulk.flatMap(g => g.styles);
    expect(rows.map(r => r.po).sort()).toEqual(["PO100519", "PO100520"]);
    expect(filterFollowProducts(lists, "Windsurfer").bulk.flatMap(g => g.styles)).toHaveLength(2);
    expect(filterFollowProducts(lists, "00186700", "2026-10-01").bulk).toHaveLength(0);
    expect(rows[0].shipmentDates).toEqual([]);
    expect(rows[0].colors[0].colorTrims?.mainLabel).toBe("大号白色主唛");
    expect(filterFollowProducts(lists, "白底黑字").bulk.flatMap(g => g.styles)).toHaveLength(2);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: a.sheetId, action: "follow.merch_saved" } });
    expect(audit.actorUserId).toBe(actor.userId);
    expect(audit.createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(audit.payloadJson!).before.styles).toEqual([]);
    expect(JSON.parse(audit.payloadJson!).after.styles[0].bulk.purchaseDate).toBe("2026-09-09");
    expect(JSON.parse(audit.payloadJson!).after.styles[0].bulk.colors[0].colorTrims.careSizeLabel).toBe("白底黑字");
    const registry = businessTools(actor, "follow", "查产品 00186700 九月的 PO");
    const result = await registry.tools.find(t => t.name === "read_follow_records")!.run({ query: "00186700", from: "2026-09-01", to: "2026-09-30" }) as { total: number };
    expect(result.total).toBe(2);
    expect(registry.tables[0].columns).toContain("产品编号 / 款号");
    expect(registry.tables[0].rows.every(r => r.href)).toBe(true);
    expect(registry.tables[1].rows[0].cells[2]).toContain("大号白色主唛");
    expect((await resolveContext(actor, "follow")).instructions).toContain("客户采购日期来自客户 PO 原单");
    expect(await prisma.salesOrder.count()).toBe(orders);
    expect(await prisma.purchaseDraft.count()).toBe(purchases);
  });

  it("开单保留 PO 原始要求和数量，不把计划当确认/出运；按关联查回出运登记", async () => {
    const input = await prepare("po-open");
    const created = await open(input, "open-po-001");
    expect((await open(input, "open-po-001")).orderId).toBe(created.orderId);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.orderId }, include: { lines: { include: { colors: true } }, source: true } });
    expect(order.externalCustomerPo).toBe("PO100519");
    expect(order.orderNo).not.toBe("PO100519");
    expect(order.requestedDeliveryText).toBe("2026-11-20");
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.lines[0].totalQuantity).toBe(4433);
    expect(order.lines[0].colors).toHaveLength(3);
    expect(JSON.parse(order.source!.rawText).styles[0].salesSample.numericCode).toBe("00186700");
    await prisma.productionQty.create({ data: { id: "po-test-shipment", orderId: order.id, kind: "shipped", quantity: 100, createdAt: new Date("2026-11-21T02:00:00Z"), idempotencyKey: "shipment-po-test" } });
    const lists = await listFollowProducts(actor.organizationId, viewer);
    const rows = filterFollowProducts(lists, "PO100519").bulk.flatMap(g => g.styles);
    expect(rows[0].shipDate).toBe("2026-11-20");
    expect(rows[0].shipmentDates).toEqual(["2026-11-21"]);
    expect(rows[0].productionOrderNo).toBe(order.orderNo);
    const updated = line(); updated.bulk.colors[0].qtyText = "999";
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: input.sheetId } });
    await expect(saveFollowSheet({ ...input, expectedUpdatedAt: sheet.updatedAt.toISOString(), styles: [updated], idempotencyKey: "after-open-save" })).rejects.toThrow(/已开生产订单/);
    await expect(saveOrderMerch({ ...actor, orderId: order.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), styles: [updated], idempotencyKey: "after-open-order" })).rejects.toThrow(/已开生产订单/);
  });

  it("不同 PO、缺号混合和未核对旧编号均不误建单，重复款行保留独立键", async () => {
    const before = await prisma.salesOrder.count();
    const input = await prepare("po-mixed", [line(), line("PO100520")]);
    await expect(open(input, "open-po-mixed")).rejects.toThrow(/不同 PO/);
    const rows = (await listFollowProducts(actor.organizationId, viewer)).bulk.flatMap(g => g.styles).filter(r => r.key.startsWith(`${input.sheetId}:`));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
    const legacy = line(); Object.assign(legacy.bulk, { orderNo: "LEGACY-42" });
    const old = await prepare("po-legacy", [legacy]);
    await expect(open(old, "open-po-legacy")).rejects.toThrow(/原订单号/);
    const missing = await prepare("po-missing", [line(), line("")]);
    await expect(open(missing, "open-po-missing")).rejects.toThrow(/部分款未填 PO/);
    expect(await prisma.salesOrder.count()).toBe(before);
  });

  it("翻单同客户产品编号不变；旧批次资料保留，不允许把编号改成新编号", async () => {
    const first = await prepare("batch-first");
    const old = await open(first, "open-first-batch");
    const next = line("PO100520"); next.bulk.colors = [{ guestColor: "黑色", qtyText: "200", colorTrims: { mainLabel: "小号黑色主唛", careSizeLabel: "黑底白字" } }];
    const second = await prepare("batch-next", [next]);
    const newer = await open(second, "open-next-batch");
    expect(newer.orderId).not.toBe(old.orderId);
    const original = await prisma.salesOrder.findUniqueOrThrow({ where: { id: old.orderId }, include: { lines: true } });
    expect(original.externalCustomerPo).toBe("PO100519");
    expect(original.lines[0].totalQuantity).toBe(4433);
    const wrong = await prepare("batch-wrong", [line("PO100521", "OTHER-ID")]);
    await expect(open(wrong, "open-wrong-batch")).rejects.toThrow(/历史批次不一致/);
  });

  it("过期确认、重复标记改内容、伪造角色均被拦截，修改仍可保存并保留前后值", async () => {
    const input = await prepare("po-audit");
    const changed = line(); changed.bulk.purchaseDate = "2026-09-10";
    await expect(saveFollowSheet({ ...input, styles: [changed] })).rejects.toThrow(/标记已用于其他内容/);
    const saved = await saveFollowSheet({ ...input, styles: [changed], idempotencyKey: "save-real-change" });
    await expect(open(input, "open-stale-stamp")).rejects.toThrow(/已变化/);
    await expect(saveFollowSheet({ ...input, role: "manager", expectedUpdatedAt: saved.expectedUpdatedAt, idempotencyKey: "save-false-role" })).rejects.toThrow(/权限已变化/);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: input.sheetId, action: "follow.merch_saved", payloadJson: { contains: "save-real-change" } } });
    expect(JSON.parse(audit.payloadJson!).before.styles[0].bulk.purchaseDate).toBe("2026-09-09");
    expect(JSON.parse(audit.payloadJson!).after.styles[0].bulk.purchaseDate).toBe("2026-09-10");
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: input.sheetId }, include: { styles: true } });
    expect(readStoredMerchStyles(sheet, { styleCode: "", styleName: "" })[0].bulk.purchaseDate).toBe("2026-09-10");
  });
});
