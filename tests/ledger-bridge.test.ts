import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { PrismaClient } from "@prisma/client";
import { IDS } from "@/lib/constants";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { runTradeCommand } from "@/server/services/trade-write";
import { runTreasuryCommand } from "@/server/services/treasury-write";
import { runMaterialCommand } from "@/server/services/material-write";
import { setUserPermission } from "@/server/services/user-permissions";
import { listLedgerBridge, getLedgerSourceBridge } from "@/server/services/ledger-bridge";
import { readLedgerSource } from "@/server/services/ledger-source";
import { generateFactoryReconDraft, getFactoryReconPreview, getFactoryReconPreviews } from "@/server/services/recon";
import { changedBusinessBills } from "@/server/services/ledger-business-check";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const reviewer = { ...actor, userId: IDS.userSales, role: "salesperson" };
let n = 0;
const ledger = (data: Record<string, unknown>, who = actor) => runLedgerCommand(who, { ...data, idempotencyKey: `bridge-gl-${++n}` });
const trade = (data: Record<string, unknown>) => runTradeCommand(actor, { ...data, idempotencyKey: `bridge-trade-${++n}` });
const material = (data: Record<string, unknown>) => runMaterialCommand(actor, { ...data, idempotencyKey: `bridge-material-${++n}` });
async function book() {
  const b = await ledger({ action: "create_book", name: `贯通验收${++n}`, baseCurrency: "CNY", startMonth: "2026-09" });
  for (const action of ["ledger_view", "ledger_review"]) await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: reviewer.userId, action, enabled: true });
  return b.id;
}
async function bill(extra: Record<string, unknown> = {}) {
  const b = await trade({ action: "create_bill", orderId: "order-demo-005", direction: "payable", partyId: IDS.supplierQinghe, title: `材料款${++n}`, category: "materials", currency: "CNY", amount: "100", dueDate: "2026-09-20", basis: "测试依据", ...extra });
  await trade({ action: "confirm_bill", id: b.id, expectedVersion: 1 });
  return b.id;
}
async function cash() { return (await trade({ action: "record_cash", direction: "receive", partyId: "customer-qinglan", currency: "USD", amount: "1000", fee: "0", bankAccount: "隔离美元户", bankReference: `BR-${++n}`, occurredOn: "2026-09-18", basis: "虚构到账" })).id; }
async function sourceJournal(bookId: string, type: string, id: string) {
  const accounts = await prisma.gLAccount.findMany({ where: { bookId } });
  return ledger({ action: "from_source", bookId, date: "2026-09-20", sourceType: type, sourceId: id, debitAccountId: accounts.find(a => a.code === "A-INVENTORY")!.id, creditAccountId: accounts.find(a => a.code === "L-AP")!.id, rate: type === "cash" ? "7" : "1", rateDate: "2026-09-20", basis: "仅隔离测试的科目映射" });
}
async function post(id: string) { await ledger({ action: "review_journal", id, expectedVersion: 1 }, reviewer); await ledger({ action: "post_journal", id, expectedVersion: 2 }); }

describe("业务与总账贯通", () => {
  beforeEach(resetDatabase);
  it("按账套显示待制单、草稿、待过账、已过账、冲销中、已冲销和重新制单", async () => {
    const b = await book(), another = await book(), id = await bill();
    const state = async () => (await getLedgerSourceBridge(actor, b, "bill", id)).source.state;
    expect(await state()).toBe("ready");
    const j = await sourceJournal(b, "bill", id); expect(await state()).toBe("draft");
    await ledger({ action: "review_journal", id: j.id, expectedVersion: 1 }, reviewer); expect(await state()).toBe("reviewed");
    await ledger({ action: "post_journal", id: j.id, expectedVersion: 2 }); expect(await state()).toBe("posted");
    expect((await getLedgerSourceBridge(actor, another, "bill", id)).source.state).toBe("ready");
    const reversal = await ledger({ action: "reverse_journal", id: j.id, expectedVersion: 3, date: "2026-09-20", reason: "核对更正" });
    expect(await state()).toBe("reversing"); await post(reversal.id); expect(await state()).toBe("reversed");
    const next = await sourceJournal(b, "bill", id); expect(await state()).toBe("draft");
    const detail = await getLedgerSourceBridge(actor, b, "bill", id);
    expect(detail.history.map(x => x.id)).toEqual(expect.arrayContaining([j.id, reversal.id, next.id]));
  });
  it("扣补是独立待入账来源，原单已过账不被扣补误判为变化", async () => {
    const b = await book(), id = await bill(); const j = await sourceJournal(b, "bill", id); await post(j.id);
    await trade({ action: "adjust_bill", id, expectedVersion: 2, amount: "-20", reason: "退补差额" });
    const queue = await listLedgerBridge(actor, b, { orderId: "order-demo-005", state: "pending" });
    expect(queue.rows.map(x => x.type)).toEqual(["adjustment"]);
    expect(queue.rows[0].amount).toBe("-20.00");
    expect((await getLedgerSourceBridge(actor, b, "bill", id)).source.state).toBe("posted");
  });
  it("失效来源和变更后的草稿不会显示已核对；作废草稿回到待制单", async () => {
    const b = await book(), id = await cash(), j = await sourceJournal(b, "cash", id);
    await prisma.tradeCash.update({ where: { id }, data: { basis: "备注不改变金额来源", bankReference: "CHANGED-REFERENCE" } });
    expect((await getLedgerSourceBridge(actor, b, "cash", id)).source.state).toBe("changed");
    expect((await listLedgerBridge(actor, b, { state: "changed" })).total).toBe(1);
    await ledger({ action: "void_journal", id: j.id, expectedVersion: 1, reason: "按新来源重建" });
    expect((await getLedgerSourceBridge(actor, b, "cash", id)).source.state).toBe("ready");
    await trade({ action: "void_cash", id, expectedVersion: 1, reason: "误登记" });
    expect((await getLedgerSourceBridge(actor, b, "cash", id)).source.state).toBe("inactive");
  });
  it("收料价差进入来源待核对，处理应付差异后单独出现扣补，已过账原单保留", async () => {
    const b = await book();
    const r = await material({ action: "receive", orderId: "order-demo-005", supplierId: IDS.supplierQinghe, materialId: IDS.materialD06, locationId: IDS.warehouse, colorName: "本色", qty: "100", reference: "BR-RECEIPT", occurredOn: "2026-09-18", basis: "验收放行" });
    await material({ action: "value_receipt", id: r.id, expectedVersion: 1, currency: "CNY", unitPrice: "2.50", basis: "单价" });
    const id = await bill({ sourceKind: "receipt", sourceId: r.id, amount: "250" }), j = await sourceJournal(b, "bill", id); await post(j.id);
    await material({ action: "value_receipt", id: r.id, expectedVersion: 2, currency: "CNY", unitPrice: "3", basis: "供应商更正价格" });
    const changed = await getLedgerSourceBridge(actor, b, "bill", id);
    expect(changed.source.state).toBe("changed"); expect(changed.source.issue).toMatch(/收料|计价|来源/);
    const other = await book(); await expect(sourceJournal(other, "bill", id)).rejects.toThrow(/来源|变化/);
    await material({ action: "sync_payable", id: r.id, billId: id, expectedVersion: 3, expectedBillVersion: 2, basis: "财务核对价差" });
    expect((await getLedgerSourceBridge(actor, b, "bill", id)).source.state).toBe("posted");
    expect((await listLedgerBridge(actor, b, { state: "ready" })).rows.some(x => x.type === "adjustment" && x.amount === "50.00")).toBe(true);
  });
  it("资金腿不重复列，退款/结汇与原流水的快照和原币金额准确", async () => {
    const b = await book(), id = await cash();
    const r = await runTreasuryCommand(actor, { action: "record_refund", sourceCashId: id, expectedVersion: 1, amount: "100", fee: "0", bankAccount: "隔离美元户", bankReference: "BR-REFUND", occurredOn: "2026-09-20", basis: "退款", idempotencyKey: "bridge-refund" });
    const fx = await runTreasuryCommand(actor, { action: "record_fx", sourceCashId: id, expectedVersion: 2, amount: "200", toCurrency: "CNY", rate: "7", fee: "1", toAccount: "人民币户", bankReference: "BR-FX", occurredOn: "2026-09-20", rateDate: "2026-09-20", basis: "结汇", idempotencyKey: "bridge-fx" });
    const rows = (await listLedgerBridge(actor, b)).rows; expect(rows).toHaveLength(3);
    for (const [type, sourceId] of [["cash", id], ["refund", r.id], ["fx", fx.id]]) {
      const detail = await getLedgerSourceBridge(actor, b, type, sourceId), direct = await readLedgerSource(prisma, actor.organizationId, type, sourceId);
      expect(JSON.parse(detail.source.facts)).toEqual(direct.facts);
    }
    await sourceJournal(b, "cash", id); await sourceJournal(b, "refund", r.id);
    expect((await listLedgerBridge(actor, b, { state: "draft" })).rows.map(row => row.type).sort()).toEqual(["cash", "refund"]);
    const accounts = await prisma.gLAccount.findMany({ where: { bookId: b } }), account = (code: string) => accounts.find(a => a.code === code)!.id;
    await ledger({ action: "from_source", bookId: b, date: "2026-09-20", sourceType: "fx", sourceId: fx.id, debitAccountId: account("A-BANK"), creditAccountId: account("A-AR"), feeAccountId: account("X-FEE"), gainLossAccountId: account("X-FX"), rateDate: "2026-09-20", carryingAmount: "1400", basis: "虚构账面金额" });
    expect((await getLedgerSourceBridge(actor, b, "fx", fx.id)).source.state).toBe("draft");
  });
  it("分页在筛选后计数，未确认业务不冒充待入账，跨组织与撤权拒绝", async () => {
    const b = await book(); for (let i = 0; i < 22; i++) await bill();
    const one = await listLedgerBridge(actor, b, { state: "ready" }), two = await listLedgerBridge(actor, b, { state: "ready", page: 2 });
    expect(one.total).toBe(22); expect(one.rows).toHaveLength(20); expect(two.rows).toHaveLength(2);
    expect(new Set([...one.rows, ...two.rows].map(r => r.id)).size).toBe(22);
    await expect(listLedgerBridge(reviewer, b)).rejects.toThrow(/无权/);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: reviewer.userId, action: "trade_view", enabled: true });
    expect((await listLedgerBridge(reviewer, b)).total).toBe(22);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: reviewer.userId, action: "ledger_view", enabled: false });
    await expect(listLedgerBridge(reviewer, b)).rejects.toThrow(/无权/);
    await expect(listLedgerBridge({ ...actor, organizationId: "org-other" }, b)).rejects.toThrow();
    await expect(getLedgerSourceBridge(actor, b, "bill", "missing")).rejects.toThrow(/不存在/);
  });
  it("订单只带出有效核销关联资金，退款/换汇沿来源追溯，撤回核销不伪造订单归属", async () => {
    const b = await book(), cashId = await cash();
    await trade({ action: "save_contract", orderId: "order-demo-005", currency: "USD", amount: "1000", tradeMode: "unknown", incoterm: "", terms: "虚构合同", expectedVersion: 0 });
    const ar = await trade({ action: "create_bill", orderId: "order-demo-005", direction: "receivable", title: "部分收款", category: "deposit", currency: "USD", amount: "700", dueDate: "2026-09-20", basis: "合同" });
    await trade({ action: "confirm_bill", id: ar.id, expectedVersion: 1 });
    expect((await listLedgerBridge(actor, b, { orderId: "order-demo-005" })).rows.map(r => r.type)).toEqual(["bill"]);
    const allocation = await trade({ action: "allocate", billId: ar.id, cashId, cashAmount: "700", expectedBillVersion: 2, expectedCashVersion: 1 });
    const refund = await runTreasuryCommand(actor, { action: "record_refund", sourceCashId: cashId, expectedVersion: 2, amount: "100", fee: "0", bankAccount: "隔离美元户", bankReference: "LINK-REFUND", occurredOn: "2026-09-20", basis: "实际退款", idempotencyKey: "link-refund" });
    await runTreasuryCommand(actor, { action: "record_fx", sourceCashId: cashId, expectedVersion: 3, amount: "200", toCurrency: "CNY", rate: "7", fee: "0", toAccount: "人民币户", bankReference: "LINK-FX", occurredOn: "2026-09-20", rateDate: "2026-09-20", basis: "实际结汇", idempotencyKey: "link-fx" });
    const linked = await listLedgerBridge(actor, b, { orderId: "order-demo-005" });
    expect(linked.rows.map(r => r.type).sort()).toEqual(["bill", "cash", "fx", "refund"]);
    expect(linked.rows.find(r => r.type === "cash")?.amount).toBe("1000.00");
    expect((await getLedgerSourceBridge(actor, b, "refund", refund.id)).orders.map(o => o.id)).toEqual(["order-demo-005"]);
    await trade({ action: "reverse_allocation", id: allocation.id, reason: "误归单" });
    expect((await listLedgerBridge(actor, b, { orderId: "order-demo-005" })).rows.map(r => r.type)).toEqual(["bill"]);
  });
  it("批量加工快照与既有单笔规则一致，出运变化进入待核对并阻止旧草稿过账", async () => {
    const b = await book();
    const recon = await generateFactoryReconDraft({ ...actor, orderId: "order-demo-005", idempotencyKey: "bridge-recon" });
    const preview = await getFactoryReconPreview(actor.organizationId, "order-demo-005");
    expect((await getFactoryReconPreviews(actor.organizationId, ["order-demo-005"])).get("order-demo-005")?.snapshot).toBe(preview.snapshot);
    const id = await bill({ partyId: preview.factoryId, category: "processing", sourceKind: "recon", sourceId: recon.draft.id, amount: preview.draft!.amountYuan });
    const j = await sourceJournal(b, "bill", id);
    await prisma.productionQty.create({ data: { id: "bridge-extra-shipped", orderId: "order-demo-005", kind: "shipped", quantity: 1, idempotencyKey: "bridge-extra-shipped" } });
    expect((await listLedgerBridge(actor, b, { state: "changed" })).rows.find(r => r.id === id)?.issue).toMatch(/加工/);
    await expect(ledger({ action: "review_journal", id: j.id, expectedVersion: 1 }, reviewer)).rejects.toThrow(/变化|重新核对/);
  });
  it("同批来源从1张增长到21张时，不逐单增加收料核对SQL", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 21; i++) {
      const r = await material({ action: "receive", orderId: "order-demo-005", supplierId: IDS.supplierQinghe, materialId: IDS.materialD06, locationId: IDS.warehouse, colorName: "本色", qty: "1", reference: `BATCH-${i}`, occurredOn: "2026-09-18", basis: "验收" });
      await material({ action: "value_receipt", id: r.id, expectedVersion: 1, currency: "CNY", unitPrice: "1", basis: "核价" });
      ids.push(await bill({ sourceKind: "receipt", sourceId: r.id, amount: "1" }));
    }
    const measured = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
    let queries = 0; measured.$on("query", () => { queries++; });
    try {
      expect((await changedBusinessBills(measured, actor, undefined, ids[0])).size).toBe(0);
      const one = queries; queries = 0;
      expect((await changedBusinessBills(measured, actor)).size).toBe(0);
      expect(queries).toBe(one);
      console.log(JSON.stringify({ upstreamSourceQueries: { oneBill: one, twentyOneBills: queries } }));
    } finally { await measured.$disconnect(); }
  });
});
