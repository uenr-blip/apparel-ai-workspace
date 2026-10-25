import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createFollowSheet, saveFollowSheet, openFollowAsOrder, listFollowProducts } from "@/server/services/order-merch";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };
const row = (code: string, po = "PO-REST", qty = "20") => ({ styleCode: code, bulk: { po, colors: [{ guestColor: "灰色", qtyText: qty }] } });
async function get(id: string) { return prisma.orderMerchSheet.findUniqueOrThrow({ where: { id }, include: { styles: { orderBy: { sort: "asc" } } } }); }
async function setup(styles: unknown[]) {
  const c = await createFollowSheet({ ...actor, kind: "bulk", title: "接续测试", factoryName: "云杉服装工厂", idempotencyKey: "create-continuation" });
  const s = await get(c.sheetId);
  await saveFollowSheet({ ...actor, sheetId: c.sheetId, expectedUpdatedAt: s.updatedAt.toISOString(), factoryName: s.factoryName, styles, idempotencyKey: "save-continuation" });
  return c.sheetId;
}
async function open(id: string, key: string, rowIds?: string[]) { const s = await get(id); return openFollowAsOrder({ ...actor, sheetId: id, customerId: IDS.customerNorthshore, expectedUpdatedAt: s.updatedAt.toISOString(), idempotencyKey: key, rowIds }); }
beforeEach(resetDatabase);
describe("总表逐款接续开单", () => {
  it("先开已建档款、再补剩余款，稳定款行及原单不变，不能重复转出", async () => {
    const id = await setup([row("ST-26003"), row("尚未建档")]);
    const a = await open(id, "open-ready-first"); expect(a.styleCount).toBe(1); expect(a.skipped).toHaveLength(1);
    const first = await get(id); const styles = readStoredMerchStyles(first, { styleCode: "", styleName: "" });
    expect(first.styles[0].productionLineId).toBeTruthy(); expect(first.styles[1].productionLineId).toBeNull();
    const table = (await listFollowProducts(IDS.orgDemo, { role: "salesperson", factoryId: null })).bulk.flatMap(g => g.styles).filter(r => r.key.startsWith(`${id}:`));
    expect(table[0].productionHref).toBe(`/orders/${a.orderId}`); expect(table[1].productionHref).toBe("");
    styles[1].styleCode = "ST-26018";
    const save = await saveFollowSheet({ ...actor, sheetId: id, expectedUpdatedAt: first.updatedAt.toISOString(), idempotencyKey: "save-ready-second", factoryName: first.factoryName, styles });
    expect(save.styles.map(s => s.rowId)).toEqual(first.styles.map(s => s.id));
    const b = await open(id, "open-ready-second", [first.styles[1].id]); expect(b.orderId).not.toBe(a.orderId); expect(b.styleCount).toBe(1);
    const final = await get(id); expect(final.salesOrderId).toBe(a.orderId); expect(final.styles.every(s => s.productionLineId)).toBe(true);
    const count = await prisma.salesOrder.count(); await open(id, "open-already-all"); expect(await prisma.salesOrder.count()).toBe(count);
    const after = readStoredMerchStyles(final, { styleCode: "", styleName: "" }); after[0].bulk.colors[0].qtyText = "21";
    await expect(saveFollowSheet({ ...actor, sheetId: id, expectedUpdatedAt: final.updatedAt.toISOString(), idempotencyKey: "change-opened-batch", factoryName: final.factoryName, styles: after })).rejects.toThrow(/已开生产订单/);
  });
  it("同一总表多 PO 逐批勾选，同款原编号沿用且各行关联独立", async () => {
    const id = await setup([row("ST-26003", "PO-A"), row("ST-26003", "PO-B")]); const s = await get(id);
    const a = await open(id, "open-po-a-only", [s.styles[0].id]); const b = await open(id, "open-po-b-only", [s.styles[1].id]);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: a.orderId } })).externalCustomerPo).toBe("PO-A");
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: b.orderId } })).externalCustomerPo).toBe("PO-B");
    expect(a.orderId).not.toBe(b.orderId);
  });
  it("有未明确颜色数量时不把部分数量当成整款开出，也不借用销售样件数", async () => {
    const incomplete = row("ST-26003"); incomplete.bulk.colors.push({ guestColor: "黑色", qtyText: "待定" });
    const id = await setup([incomplete]);
    await expect(open(id, "open-unknown-qty")).rejects.toThrow(/没有可计入/);
  });
});
