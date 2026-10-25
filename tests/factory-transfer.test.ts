import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createFollowSheet, saveFollowSheet, openFollowAsOrder, listFollowProducts } from "@/server/services/order-merch";
import { getFactoryTransferBoard, requestFactoryTransfer, reviewFactoryTransfer, listFactoryTransfers, acknowledgeFactoryTransfer, confirmTransferContinuation } from "@/server/services/factory-transfer";
import { recordProductionQty } from "@/server/services/production-board";
import { getProductionGate } from "@/server/services/production-gate";
import { assignOrderFactory } from "@/server/services/order-board";
import { resetDatabase } from "./helpers";
const sales = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };
const manager = { ...sales, userId: IDS.userManager, role: "manager" };
beforeEach(resetDatabase);
async function fixture() {
  const sheet = await createFollowSheet({ ...sales, title: "转厂真实数量测试", kind: "bulk", factoryName: "云杉服装工厂", idempotencyKey: "create-transfer-test" });
  const saved = await saveFollowSheet({ ...sales, sheetId: sheet.sheetId, expectedUpdatedAt: (await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: sheet.sheetId } })).updatedAt.toISOString(), idempotencyKey: "save-transfer-test", factoryName: "云杉服装工厂", styles: [{ styleCode: "ST-26003", salesSample: { numericCode: "TRANSFER-01" }, bulk: { po: "PO-TRANSFER", colors: [{ guestColor: "海军蓝", qtyText: "60" }, { guestColor: "灰色", qtyText: "40" }] } }] });
  const opened = await openFollowAsOrder({ ...sales, sheetId: sheet.sheetId, customerId: IDS.customerNorthshore, expectedUpdatedAt: saved.expectedUpdatedAt, idempotencyKey: "open-transfer-test" });
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: opened.orderId }, include: { lines: { include: { colors: true } } } });
  for (const color of order.lines[0].colors) await prisma.orderSizeQty.create({ data: { id: `size-${color.id}`, colorId: color.id, sizeCode: "M", quantity: color.quantity } });
  await prisma.salesOrder.update({ where: { id: order.id }, data: { status: "confirmed", productionReadiness: "ready_for_production" } });
  await prisma.productionQty.create({ data: { id: "transfer-original-start", orderId: order.id, kind: "started", quantity: 20, idempotencyKey: "start-transfer-test", lines: { create: { id: "transfer-original-start-line", colorName: "海军蓝", sizeCode: "M", quantity: 20 } } } });
  await prisma.party.create({ data: { id: "transfer-target", organizationId: IDS.orgDemo, kind: "factory", code: "FACTORY-TF", name: "转厂接收工厂", demoNote: "隔离测试" } });
  return { id: order.id, sheetId: sheet.sheetId };
}
async function request(id: string, quantities = [10, 30], key = "request-transfer-test") {
  const board = await getFactoryTransferBoard(sales, id);
  return requestFactoryTransfer(sales, { orderId: id, toFactoryId: "transfer-target", reason: "原厂产能不足，保留已开工部分", sourceReference: "交接单 TF-001", stamp: board.stamp, idempotencyKey: key, selections: board.rows.map(r => ({ sizeId: r.sizeId, quantity: r.colorName === "海军蓝" ? quantities[0] : quantities[1] })).filter(r => r.quantity > 0) });
}
describe("转厂不覆盖原厂生产，按色尺拆分未开工余量", () => {
  it("部分转厂经过负责人和主管，总表数量守恒、原厂产量保留，新单不能自动投产", async () => {
    const f = await fixture();
    const production = await prisma.productionQty.findMany({ where: { orderId: f.id }, include: { lines: true } });
    const record = await request(f.id);
    await expect(reviewFactoryTransfer(sales, { id: record.id, action: "approve", note: "同意" })).rejects.toThrow(/主管/);
    await expect(reviewFactoryTransfer(manager, { id: record.id, action: "approve", note: "同意" })).rejects.toThrow(/尚未核对/);
    await reviewFactoryTransfer(sales, { id: record.id, action: "review", note: "原料留原厂，新增调料另办，原厂费用单独核对，交期不改" });
    const done = await reviewFactoryTransfer(manager, { id: record.id, action: "approve", note: "同意转未开工40件，原厂保留60件" });
    expect((await reviewFactoryTransfer(manager, { id: record.id, action: "approve", note: "同意" })).orderId).toBe(done.orderId);
    const newOrder = await prisma.salesOrder.findUniqueOrThrow({ where: { id: done.orderId! }, include: { lines: { include: { colors: true } } } });
    expect(newOrder).toMatchObject({ factoryId: "transfer-target", externalCustomerPo: "PO-TRANSFER", productionReadiness: "blocked_factory_transfer" });
    expect(newOrder.lines[0].totalQuantity).toBe(40);
    const original = await prisma.salesOrder.findUniqueOrThrow({ where: { id: f.id }, include: { lines: true } });
    expect(original.factoryId).toBe(IDS.factoryYunshan);
    expect(original.lines[0].totalQuantity).toBe(60);
    expect(await prisma.productionQty.findMany({ where: { orderId: f.id }, include: { lines: true } })).toEqual(production);
    expect(await prisma.productionQty.count({ where: { orderId: newOrder.id } })).toBe(0);
    const total = (await listFollowProducts(IDS.orgDemo, { role: "salesperson", factoryId: null })).bulk.flatMap(g => g.styles).filter(r => r.po === "PO-TRANSFER");
    expect(total).toHaveLength(2);
    expect(total.flatMap(r => r.colors).reduce((n, c) => n + Number(c.qtyText), 0)).toBe(100);
    expect(total.every(r => /转厂接收|已转出/.test(r.productionProgress))).toBe(true);
    expect((await getProductionGate(IDS.orgDemo, newOrder.id)).blockers).toContain("新工厂尚未确认接收转厂任务");
    await acknowledgeFactoryTransfer(sales, { id: record.id, note: "新厂已确认，回执 TF-001-A" });
    expect((await getProductionGate(IDS.orgDemo, newOrder.id)).blockers).not.toContain("新工厂尚未确认接收转厂任务");
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: newOrder.id } })).productionReadiness).toBe("blocked_factory_transfer");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: record.id, action: "factory_transfer.executed" } });
    expect(audit.actorUserId).toBe(IDS.userManager);
    expect(JSON.parse(audit.payloadJson!).before.lines[0].totalQuantity).toBe(100);
    expect(JSON.parse(audit.payloadJson!).after.newOrderId).toBe(newOrder.id);
  });
  it("可把剩余未开工全部转出；已开工数量、原厂权限和色尺上限不会转错", async () => {
    const f = await fixture(); const record = await request(f.id, [40, 40]);
    await reviewFactoryTransfer(sales, { id: record.id, action: "review", note: "80件未开工全转，新厂调料另办" });
    const done = await reviewFactoryTransfer(manager, { id: record.id, action: "approve", note: "同意" });
    const old = await prisma.orderLine.findFirstOrThrow({ where: { orderId: f.id } }); expect(old.totalQuantity).toBe(20);
    await expect(recordProductionQty({ ...manager, factoryId: null, orderId: f.id, kind: "started", quantity: 1, idempotencyKey: "exceed-after-transfer" })).rejects.toThrow(/承接数量/);
    const from = await listFactoryTransfers({ organizationId: IDS.orgDemo, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan }, { orderId: f.id });
    expect(from).toHaveLength(1); expect(from[0].canOpenSource).toBe(true); expect(from[0].canOpenTarget).toBe(false);
    expect(done.orderId).toBeTruthy();
    await expect(acknowledgeFactoryTransfer({ organizationId: IDS.orgDemo, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan }, { id: record.id, note: "伪造接收" })).rejects.toThrow(/无权/);
  });
  it("核对后新增产量使旧确认失效，不执行过期转厂", async () => {
    const f = await fixture(); const r = await request(f.id); await reviewFactoryTransfer(sales, { id: r.id, action: "review", note: "核对完成" });
    await prisma.productionQty.create({ data: { id: "extra-start-tf", orderId: f.id, kind: "started", quantity: 1, idempotencyKey: "extra-start-tf", lines: { create: { id: "extra-start-tf-line", colorName: "海军蓝", sizeCode: "M", quantity: 1 } } } });
    await expect(reviewFactoryTransfer(manager, { id: r.id, action: "approve", note: "同意" })).rejects.toThrow(/依据已变化/);
    expect((await prisma.factoryTransfer.findUniqueOrThrow({ where: { id: r.id } })).newOrderId).toBeNull();
  });
  it("超出余量、未核实旧产量、外公司目标和伪造角色均不生成转厂", async () => {
    const f = await fixture(); await expect(request(f.id, [41, 40])).rejects.toThrow(/超过未开工/);
    const b = await getFactoryTransferBoard(sales, f.id);
    const input = { orderId: f.id, toFactoryId: "party-iso-factory", reason: "test", sourceReference: "test", stamp: b.stamp, idempotencyKey: "tf-invalid-target", selections: [{ sizeId: b.rows[0].sizeId, quantity: 1 }] };
    await expect(requestFactoryTransfer(sales, input)).rejects.toThrow(/另一家工厂/);
    await expect(requestFactoryTransfer({ ...sales, role: "manager" }, input)).rejects.toThrow(/无权/);
    await prisma.productionQtyLine.deleteMany({ where: { productionQtyId: "transfer-original-start" } });
    expect((await getFactoryTransferBoard(sales, f.id)).rows.every(r => r.available === 0 && r.reason.includes("历史投产"))).toBe(true);
    expect(await prisma.factoryTransfer.count()).toBe(0);
    await expect(assignOrderFactory({ ...sales, orderId: f.id, factoryId: "transfer-target" })).rejects.toThrow(/不能直接改派/);
  });
});

describe("裁片与车缝半成品按工序接续",()=>{
  it.each(["cut","sewn"] as const)("%s 可部分转出并接收，原生产历史不覆盖，新厂不能重复计投产",async stage=>{
    const f=await fixture();const b=await getFactoryTransferBoard(sales,f.id);const blue=b.rows.find(r=>r.colorName==="海军蓝")!;
    const r=await requestFactoryTransfer(sales,{orderId:f.id,toFactoryId:"transfer-target",stage,processNote:stage==="cut"?"裁片已裁齐，新厂从车缝开始":"已车缝大身，新厂接续领袖与后整",reason:"原厂排期不足",sourceReference:"实物交接清单 TF-WIP",stamp:b.stamp,idempotencyKey:`wip-${stage}-request`,selections:[{sizeId:blue.sizeId,quantity:10}]});
    await reviewFactoryTransfer(sales,{id:r.id,action:"review",note:"核对在制10件，质量问题已注明，原厂费用单独结算"});const done=await reviewFactoryTransfer(manager,{id:r.id,action:"approve",note:"同意在制交接，新厂核对后重新放行"});
    expect((await prisma.productionQty.findUniqueOrThrow({where:{id:"transfer-original-start"}})).quantity).toBe(20);
    expect((await prisma.productionQty.findFirstOrThrow({where:{orderId:f.id,kind:"transfer_out"}})).quantity).toBe(10);
    expect(await prisma.productionQty.count({where:{orderId:done.orderId!}})).toBe(0);
    await expect(acknowledgeFactoryTransfer(sales,{id:r.id,note:"点收9件",receivedQuantity:9,continuationNote:"继续车缝"})).rejects.toThrow(/数量不符/);
    await acknowledgeFactoryTransfer(sales,{id:r.id,note:"点收清单和捆号一致",receivedQuantity:10,continuationReady:stage === "cut",continuationNote:"裁片/半成品实物合格，后续用线领料已核对齐备，按交接工序继续"});
    expect((await prisma.productionQty.findFirstOrThrow({where:{orderId:done.orderId!,kind:"transfer_in"}})).quantity).toBe(10);
    if (stage === "sewn") {
      const receipt = await prisma.factoryTransfer.findUniqueOrThrow({ where: { id: r.id } });
      expect(JSON.parse(receipt.afterJson).receipt.continuationReady).toBe(false);
      expect((await getProductionGate(IDS.orgDemo, done.orderId!)).blockers.join(" ")).toMatch(/接续|齐备|用料/);
      await expect(confirmTransferContinuation(sales, { id: r.id, expectedUpdatedAt: receipt.updatedAt.toISOString(), continuationReady: false, note: "仅实物接收，缝纫线尚未齐" })).rejects.toThrow(/核对/);
      await expect(confirmTransferContinuation(sales, { id: r.id, expectedUpdatedAt: "2020-01-01T00:00:00.000Z", continuationReady: true, note: "核对齐备" })).rejects.toThrow(/已变化/);
      await confirmTransferContinuation(sales, { id: r.id, expectedUpdatedAt: receipt.updatedAt.toISOString(), continuationReady: true, note: "实物复核无误，后续缝纫线按领料单到位，接续后整" });
      expect(JSON.parse((await prisma.factoryTransfer.findUniqueOrThrow({ where: { id: r.id } })).afterJson).receipt.continuationReady).toBe(true);
      expect(await prisma.productionQty.count({ where: { orderId: done.orderId!, kind: "transfer_in" } })).toBe(1);
      expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: done.orderId! } })).productionReadiness).toBe("blocked_factory_transfer");
      expect((await prisma.auditEvent.findFirstOrThrow({ where: { entityId: r.id, action: "factory_transfer.continuation_checked" } })).actorUserId).toBe(IDS.userSales);
    }
    await expect(recordProductionQty({...manager,factoryId:null,orderId:done.orderId!,kind:"good",idempotencyKey:"wip-before-release",lines:[{colorName:"海军蓝",sizeCode:"M",quantity:1}]})).rejects.toThrow(/阻塞/);
    await prisma.salesOrder.update({where:{id:done.orderId!},data:{productionReadiness:"ready_for_production"}});
    await expect(recordProductionQty({...manager,factoryId:null,orderId:done.orderId!,kind:"started",idempotencyKey:"wip-double-start",lines:[{colorName:"海军蓝",sizeCode:"M",quantity:1}]})).rejects.toThrow(/承接数量/);
    await recordProductionQty({...manager,factoryId:null,orderId:done.orderId!,kind:"good",idempotencyKey:"wip-good",lines:[{colorName:"海军蓝",sizeCode:"M",quantity:10}]});
    expect((await getFactoryTransferBoard(sales,f.id)).rows.find(row=>row.colorName==="海军蓝")?.wipAvailable).toBe(10);
    const table=(await listFollowProducts(IDS.orgDemo,{role:"salesperson",factoryId:null})).bulk.flatMap(g=>g.styles).filter(r=>r.po==="PO-TRANSFER");expect(table.flatMap(r=>r.colors).reduce((n,c)=>n+Number(c.qtyText),0)).toBe(100);
  });
});
