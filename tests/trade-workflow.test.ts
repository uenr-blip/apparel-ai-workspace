import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill, getTradeContract, getTradeOverview, listTradeBills, listTradeCash } from "@/server/services/trade-read";
import { setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
let sequence = 0;
const run = (input: Record<string, unknown>, who = actor) => runTradeCommand(who, { ...input, idempotencyKey: input.idempotencyKey ?? `trade-${++sequence}` });
const contract = () => run({ action: "save_contract", orderId: "order-demo-005", currency: "USD", amount: "1000", tradeMode: "unknown", incoterm: "FOB（待核）", terms: "客户约定分两次收款", expectedVersion: 0 });
const bill = (amount = "300", direction = "receivable") => run({ action: "create_bill", orderId: "order-demo-005", direction, partyId: direction === "payable" ? IDS.factoryYunshan : "", title: "第一期", category: "deposit", currency: "USD", amount, dueDate: "2026-09-20", basis: "客户确认订金" });
const cash = (amount = "300", currency = "USD") => run({ action: "record_cash", direction: "receive", partyId: "customer-qinglan", currency, amount, fee: "0", bankAccount: "演示美元账户", bankReference: `BANK-${++sequence}`, occurredOn: "2026-09-20", basis: "人工核对银行回单" });
describe("外贸财务写入闭环", () => {
  beforeEach(resetDatabase);
  it("订单→两期应收→到账→部分核销→撤回，金额保持可追溯", async () => {
    await contract(); const a = await bill(); await bill("700");
    await run({ action: "confirm_bill", id: a.id, expectedVersion: 1 });
    const receipt = await cash("500");
    const allocation = await run({ action: "allocate", billId: a.id, cashId: receipt.id, cashAmount: "200", expectedBillVersion: 2, expectedCashVersion: 1 });
    expect((await getTradeBill(actor, a.id)).openAmount).toBe("100.00");
    expect((await listTradeCash(actor)).rows[0].unallocatedAmount).toBe("300.00");
    await run({ action: "reverse_allocation", id: allocation.id, reason: "分配错了期次" });
    expect((await getTradeBill(actor, a.id)).openAmount).toBe("300.00");
    expect((await listTradeCash(actor)).rows[0].unallocatedAmount).toBe("500.00");
  });
  it("超额计划、旧版本和未确认单据不能核销", async () => {
    await contract(); const a = await bill("900");
    await expect(bill("101")).rejects.toThrow(/合同|总额/);
    const receipt = await cash();
    await expect(run({ action: "allocate", billId: a.id, cashId: receipt.id, cashAmount: "100", expectedBillVersion: 1, expectedCashVersion: 1 })).rejects.toThrow(/确认/);
    await expect(run({ action: "confirm_bill", id: a.id, expectedVersion: 0 })).rejects.toThrow(/版本|变化/);
  });
  it("同一请求重试不重复记账，不同内容复用凭证被拒绝", async () => {
    await contract(); const request = { action: "create_bill", orderId: "order-demo-005", direction: "receivable", title: "幂等订金", category: "deposit", currency: "USD", amount: "300", dueDate: "2026-09-20", basis: "双方约定", idempotencyKey: "same-bill" };
    expect((await run(request)).id).toBe((await run(request)).id);
    await expect(run({ ...request, amount: "301" })).rejects.toThrow(/凭证|重复/);
  });
  it("跨币种核销使用明确汇率，不能超出任何一边余额", async () => {
    await contract(); const a = await bill("100"); await run({ action: "confirm_bill", id: a.id, expectedVersion: 1 });
    const receipt = await cash("700", "CNY");
    await expect(run({ action: "allocate", billId: a.id, cashId: receipt.id, cashAmount: "700", expectedBillVersion: 2, expectedCashVersion: 1 })).rejects.toThrow(/汇率/);
    await run({ action: "allocate", billId: a.id, cashId: receipt.id, cashAmount: "700", expectedBillVersion: 2, expectedCashVersion: 1, exchangeRate: "0.14285714", rateDate: "2026-09-20", rateSource: "本次结算约定" });
    expect((await getTradeBill(actor, a.id)).openAmount).toBe("0.00");
    await expect(run({ action: "void_cash", id: receipt.id, expectedVersion: 2, reason: "误登" })).rejects.toThrow(/核销/);
  });
  it("扣补保留原单，不能将单据减到已核销金额以下", async () => {
    await contract(); const a = await bill(); await run({ action: "confirm_bill", id: a.id, expectedVersion: 1 });
    await run({ action: "adjust_bill", id: a.id, expectedVersion: 2, amount: "-20", reason: "双方确认质量扣款" });
    const view = await getTradeBill(actor, a.id);
    expect(view.originalAmount).toBe("300.00"); expect(view.amount).toBe("280.00"); expect(view.adjustments).toHaveLength(1);
    await expect(run({ action: "adjust_bill", id: a.id, expectedVersion: 3, amount: "-300", reason: "错误扣款" })).rejects.toThrow(/金额|核销/);
  });
  it("不同币种概览不合计，分页不影响余额", async () => {
    await contract(); const a = await bill(); await run({ action: "confirm_bill", id: a.id, expectedVersion: 1 });
    await cash("10", "EUR"); await cash("20", "USD");
    const summary = await getTradeOverview(actor);
    expect(summary.currencies.find(row => row.currency === "USD")?.receivable).toBe("300.00");
    expect(summary.currencies.find(row => row.currency === "EUR")?.unallocatedReceive).toBe("10.00");
  });
  it("未授权和撤权用户不能写入，伪造经理身份也失败", async () => {
    const employee = { ...actor, userId: IDS.userSales, role: "salesperson" };
    await expect(run({ action: "save_contract", orderId: "order-demo-005", currency: "USD", amount: "100", tradeMode: "unknown", incoterm: "", terms: "测试", expectedVersion: 0 }, employee)).rejects.toThrow(/无权/);
    await expect(getTradeOverview({ ...actor, userId: IDS.userSales })).rejects.toThrow(/无权/);
    for (const action of ["trade_view", "trade_prepare"]) await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action, enabled: true });
    expect((await getTradeOverview(employee)).currencies).toEqual([]);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action: "trade_view", enabled: false });
    await expect(getTradeOverview(employee)).rejects.toThrow(/无权/);
  });
  it("跨组织单证与订单拒绝，不留下半张记录", async () => {
    await expect(run({ action: "save_contract", orderId: "order-iso-1", currency: "USD", amount: "100", tradeMode: "unknown", incoterm: "", terms: "测试", expectedVersion: 0 })).rejects.toThrow(/不存在|组织/);
    expect(await prisma.tradeContract.count()).toBe(0);
    expect(await prisma.tradeOperation.count()).toBe(0);
  });
  it("超过一页的应收计划仍按全量显示待拆分金额", async () => {
    await contract(); for (let i = 0; i < 21; i++) await bill("10");
    const detail = await getTradeContract(actor, "order-demo-005");
    expect(detail.contract?.plannedAmount).toBe("210.00"); expect(detail.contract?.unplannedAmount).toBe("790.00");
    const page = await listTradeBills(actor, { orderId: "order-demo-005", page: 2 });
    expect(page.total).toBe(21); expect(page.rows).toHaveLength(1);
  });
  it("有效应收即使扣补到零也不能改变原合同币种", async () => {
    await contract(); const a = await bill(); await run({ action: "confirm_bill", id: a.id, expectedVersion: 1 });
    await run({ action: "adjust_bill", id: a.id, expectedVersion: 2, amount: "-300", reason: "合同扣减" });
    await expect(run({ action: "save_contract", orderId: "order-demo-005", currency: "EUR", amount: "1000", tradeMode: "unknown", incoterm: "", terms: "试图更换币种", expectedVersion: 1 })).rejects.toThrow(/币种/);
  });
});
