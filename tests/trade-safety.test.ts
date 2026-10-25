import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill, getTradeOverview, listTradeBills, listTradeCash, listTradeDocuments } from "@/server/services/trade-read";
import { exportTrade } from "@/server/services/trade-export";
import { generateFactoryReconDraft } from "@/server/services/recon";
import { resolveStoredPath } from "@/server/storage/local";
import * as intake from "@/server/services/intake";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
let n = 0;
const run = (data: Record<string, unknown>) => runTradeCommand(actor, { ...data, idempotencyKey: data.idempotencyKey ?? `safety-${++n}` });
async function readyBill(amount = "300") {
  await run({ action: "save_contract", orderId: "order-demo-005", currency: "USD", amount: "1000", tradeMode: "unknown", incoterm: "", terms: "真实约定", expectedVersion: 0 });
  const result = await run({ action: "create_bill", orderId: "order-demo-005", direction: "receivable", title: "订金", category: "deposit", currency: "USD", amount, dueDate: "2026-09-19", basis: "合同" });
  await run({ action: "confirm_bill", id: result.id, expectedVersion: 1 }); return result;
}
const receipt = (overrides: Record<string, unknown> = {}) => run({ action: "record_cash", direction: "receive", partyId: "customer-qinglan", currency: "USD", amount: "300", fee: "10", bankAccount: "美元户1234", bankReference: `BANK-${++n}`, occurredOn: "2026-09-19", basis: "银行回单", ...overrides });
describe("外贸并发、审计及单证安全", () => {
  beforeEach(resetDatabase); afterEach(() => vi.restoreAllMocks());
  it("两个同时核销只有一个能消费旧余额", async () => {
    const bill = await readyBill(), cash = await receipt();
    const request = { action: "allocate", billId: bill.id, cashId: cash.id, cashAmount: "200", expectedBillVersion: 2, expectedCashVersion: 1 };
    const results = await Promise.allSettled([run(request), run(request)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect((await getTradeBill(actor, bill.id)).openAmount).toBe("100.00");
    expect((await listTradeCash(actor)).rows[0].unallocatedAmount).toBe("100.00");
    expect(await prisma.tradeAllocation.count()).toBe(1);
  });
  it("不同客户不能相互核销，手续费单列且不得登记未来银行流水", async () => {
    const bill = await readyBill(), wrong = await receipt({ partyId: IDS.customerNorthshore });
    await expect(run({ action: "allocate", billId: bill.id, cashId: wrong.id, cashAmount: "100", expectedBillVersion: 2, expectedCashVersion: 1 })).rejects.toThrow(/往来方/);
    expect((await listTradeCash(actor)).rows[0].bankAmount).toBe("290.00");
    await expect(receipt({ occurredOn: "2199-01-01" })).rejects.toThrow(/未来/);
  });
  it("相同银行流水号被识别，作废后才可重新登记更正", async () => {
    const first = await receipt({ bankReference: "ONE-REFERENCE" });
    await expect(receipt({ bankReference: "ONE-REFERENCE" })).rejects.toThrow(/已经登记/);
    await run({ action: "void_cash", id: first.id, expectedVersion: 1, reason: "本金录入错误" });
    await receipt({ bankReference: "ONE-REFERENCE", amount: "301" });
    expect((await listTradeCash(actor, { state: "recorded" })).total).toBe(1);
  });
  it("核销后一笔流水还能分配到第二张单据", async () => {
    const first = await readyBill("100"), cash = await receipt();
    const second = await run({ action: "create_bill", orderId: "order-demo-005", direction: "receivable", title: "尾款", category: "balance", currency: "USD", amount: "200", dueDate: "2026-09-20", basis: "合同尾款" });
    await run({ action: "confirm_bill", id: second.id, expectedVersion: 1 });
    await run({ action: "allocate", billId: first.id, cashId: cash.id, cashAmount: "100", expectedBillVersion: 2, expectedCashVersion: 1 });
    await run({ action: "allocate", billId: second.id, cashId: cash.id, cashAmount: "200", expectedBillVersion: 2, expectedCashVersion: 2 });
    expect((await listTradeCash(actor)).rows[0].unallocatedAmount).toBe("0.00");
    expect((await getTradeBill(actor, second.id)).settled).toBe(true);
  });
  it("加工草稿不能重复建应付，来源变化后旧草稿不能确认", async () => {
    const source = await generateFactoryReconDraft({ ...actor, orderId: "order-demo-005", idempotencyKey: "source-first" });
    const draft = { action: "create_bill", orderId: "order-demo-005", direction: "payable", partyId: IDS.factoryYunshan, title: "加工结算", category: "processing", currency: "CNY", amount: "12250", dueDate: "2026-09-20", basis: "实际核对加工约定", sourceKind: "recon", sourceId: source.draft.id };
    const bill = await run(draft); await expect(run(draft)).rejects.toThrow(/重复|已有/);
    await generateFactoryReconDraft({ ...actor, orderId: "order-demo-005", idempotencyKey: "source-second", unitPriceYuan: "13", basisNote: "更新加工报价" });
    await expect(run({ action: "confirm_bill", id: bill.id, expectedVersion: 1 })).rejects.toThrow(/变化/);
  });
  it("应付确认后能与已发生付款核销，未调用支付接口", async () => {
    const bill = await run({ action: "create_bill", orderId: "order-demo-005", direction: "payable", partyId: IDS.factoryYunshan, title: "加工结算", category: "processing", currency: "CNY", amount: "100", dueDate: "2026-09-20", basis: "双方确认" });
    await run({ action: "confirm_bill", id: bill.id, expectedVersion: 1 });
    const cash = await receipt({ direction: "pay", partyId: IDS.factoryYunshan, currency: "CNY", amount: "100", fee: "2" });
    await run({ action: "allocate", billId: bill.id, cashId: cash.id, cashAmount: "100", expectedBillVersion: 2, expectedCashVersion: 1 });
    expect((await getTradeBill(actor, bill.id)).settled).toBe(true);
    expect((await listTradeCash(actor)).rows[0].bankAmount).toBe("102.00");
    expect(await prisma.factoryReconDraft.count({ where: { paid: true } })).toBe(0);
  });
  it("审计失败回滚全部业务及幂等回执", async () => {
    vi.spyOn(intake, "writeAudit").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(receipt()).rejects.toThrow("audit unavailable");
    expect(await prisma.tradeCash.count()).toBe(0); expect(await prisma.tradeOperation.count()).toBe(0);
  });
  it("单证可后补私有原件，已附原件不可覆盖，跨组织不可关联", async () => {
    const command = { action: "add_document", orderId: "order-demo-005", kind: "commercial_invoice", number: "INV-001", issuedOn: "2026-09-19", note: "测试单证" };
    const doc = await run(command); expect((await listTradeDocuments(actor)).rows[0].filename).toBeNull();
    const file = { filename: "invoice.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7\nfinance test\n%%EOF") };
    await runTradeCommand(actor, { action: "attach_document", id: doc.id, idempotencyKey: "attach-once" }, file);
    await expect(runTradeCommand(actor, { action: "attach_document", id: doc.id, idempotencyKey: "attach-twice" }, file)).rejects.toThrow(/覆盖|原文件/);
    const stored = await prisma.tradeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(await readFile(resolveStoredPath(stored.storagePath!))).toEqual(file.bytes);
    await expect(run(command)).rejects.toThrow(/已经登记/);
    await expect(runTradeCommand(actor, { ...command, number: "BAD", idempotencyKey: "bad-file" }, { ...file, bytes: Buffer.from("not pdf") })).rejects.toThrow(/匹配/);
  });
  it("导出尊重筛选、留痕并防公式注入", async () => {
    await readyBill();
    await prisma.tradeBill.updateMany({ data: { title: "=HYPERLINK(\"example\")" } });
    const output = await exportTrade(actor, "bills", { currency: "USD" });
    expect(output.csv).toContain("'=HYPERLINK");
    expect(output.csv).toContain("300.00");
    expect((await exportTrade(actor, "bills", { currency: "EUR" })).csv).not.toContain("300.00");
    expect(await prisma.auditEvent.count({ where: { action: "trade.export" } })).toBe(2);
    expect((await listTradeBills(actor, { q: "%' OR 1=1 --" })).total).toBe(0);
  });
  it("有权限的另一组织经理仍不能读明细、汇总或关联本组织单证", async () => {
    await prisma.user.create({ data: { id: "trade-iso-manager", organizationId: IDS.orgIso, email: "trade-iso-manager@test.local", name: "隔离经理", role: "manager", passwordHash: "unused" } });
    const other = { ...actor, organizationId: IDS.orgIso, userId: "trade-iso-manager" };
    const command = (input: Record<string, unknown>) => runTradeCommand(other, { ...input, idempotencyKey: `other-${++n}` });
    await command({ action: "save_contract", orderId: "order-iso-1", currency: "EUR", amount: "500", tradeMode: "unknown", incoterm: "", terms: "隔离订单", expectedVersion: 0 });
    const bill = await command({ action: "create_bill", orderId: "order-iso-1", direction: "receivable", title: "隔离应收", category: "other", currency: "EUR", amount: "500", dueDate: "2026-09-20", basis: "隔离依据" });
    await command({ action: "confirm_bill", id: bill.id, expectedVersion: 1 });
    await expect(getTradeBill(actor, bill.id)).rejects.toThrow(/不存在|组织/);
    expect((await getTradeOverview(actor)).currencies).toEqual([]);
    await expect(run({ action: "add_document", orderId: "order-demo-005", kind: "other", number: "CROSS", issuedOn: "2026-09-20", note: "测试", billId: bill.id })).rejects.toThrow(/不存在|组织/);
    expect(await prisma.tradeDocument.count()).toBe(0);
  });
});
