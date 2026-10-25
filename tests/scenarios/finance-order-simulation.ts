import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { getLedgerTrial } from "@/server/services/ledger-read";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill, listTradeCash } from "@/server/services/trade-read";
import { runMaterialCommand } from "@/server/services/material-write";
import { getMaterialReceipt, getOrderCosts } from "@/server/services/material-read";
import { transferInventory, consumeInventory } from "@/server/services/inventory-move";
import { runTreasuryCommand } from "@/server/services/treasury-write";
import { createPackingDraft, occupyPackingPlan, recordCartonWeight, shipPackingPlan } from "@/server/services/packing";
import { generateFactoryReconDraft } from "@/server/services/recon";
import { setUserPermission } from "@/server/services/user-permissions";
import { saveReconciliationRule } from "@/server/services/reconciliation-rules";
import { getReconciliationReport } from "@/server/services/reconciliation-report";

/** Test fixture only. Call after resetDatabase in an isolated test database. */
export async function simulateFinanceOrder() {
  assert.match(process.env.DATABASE_URL ?? "", /test\.db$/, "Simulation must use the isolated test.db");
  const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
  const reviewer = { ...manager, userId: IDS.userSales, role: "salesperson" };
  const orderId = "order-demo-005", day = "2026-09-20";
  const checks: Array<{ name: string; expected: string; actual: string }> = [];
  const blocked: Array<{ name: string; result: string }> = [];
  let sequence = 0;
  const key = () => `full-simulation-${++sequence}`;
  const check = (name: string, actual: string | number, expected: string | number) => { assert.equal(actual, expected, name); checks.push({ name, expected: String(expected), actual: String(actual) }); };
  const reject = async (name: string, operation: () => Promise<unknown>, message: RegExp) => {
    let error: unknown; try { await operation(); } catch (e) { error = e; }
    assert(error instanceof Error && message.test(error.message), name); blocked.push({ name, result: (error as Error).message });
  };
  const gl = (input: Record<string, unknown>, actor = manager) => runLedgerCommand(actor, { ...input, idempotencyKey: key() });
  const trade = (input: Record<string, unknown>) => runTradeCommand(manager, { ...input, idempotencyKey: key() });
  const material = (input: Record<string, unknown>) => runMaterialCommand(manager, { ...input, idempotencyKey: key() });
  const treasury = (input: Record<string, unknown>) => runTreasuryCommand(manager, { ...input, idempotencyKey: key() });
  for (const action of ["ledger_view", "ledger_review", "trade_view"]) await setUserPermission({ organizationId: manager.organizationId, managerId: manager.userId, targetUserId: reviewer.userId, action, enabled: true });
  const book = await gl({ action: "create_book", name: "整单模拟验收账簿", baseCurrency: "CNY", startMonth: "2026-09" });
  await gl({ action: "create_account", bookId: book.id, code: "L-ADVANCE", name: "客户未分配款（模拟对照）", category: "liability" });
  const accounts = await prisma.gLAccount.findMany({ where: { bookId: book.id } }), account = (code: string) => accounts.find(a => a.code === code)!.id;
  await saveReconciliationRule(manager, { action: "save_reconciliation_rule", bookId: book.id, expectedVersion: 0, idempotencyKey: key(),
    accounts: { receivable: [account("A-AR")], payable: [account("L-AP")], funds: [account("A-BANK")], cost: [account("X-COST")] },
    rates: [{ currency: "USD", rate: "7", date: day, basis: "仅本模拟采用统一核对汇率7，不作为真实企业会计政策" }], basis: "全公司演示台账与本模拟账簿；资金只核对登记净变动，手工期初另列" });
  const postedIds: string[] = [];
  const post = async (id: string) => { await gl({ action: "review_journal", id, expectedVersion: 1 }, reviewer); await gl({ action: "post_journal", id, expectedVersion: 2 }); postedIds.push(id); };
  const manual = async (summary: string, lines: Array<{ code: string; debit: string; credit: string }>) => {
    const j = await gl({ action: "save_journal", bookId: book.id, date: day, summary, basis: "明确标注的模拟分录，真实财务口径待确认", expectedVersion: 0, lines: lines.map(l => ({ accountId: account(l.code), debit: l.debit, credit: l.credit, note: summary })) });
    await post(j.id); return j.id;
  };
  const fromSource = async (type: string, id: string, debitCode: string, creditCode: string, extra: Record<string, unknown> = {}) => {
    const j = await gl({ action: "from_source", bookId: book.id, date: day, sourceType: type, sourceId: id, debitAccountId: account(debitCode), creditAccountId: account(creditCode), feeAccountId: account("X-FEE"), gainLossAccountId: account("X-FX"), rate: "1", rateDate: day, basis: "本案例的明确演示映射，非已确认的企业会计规则", ...extra });
    await post(j.id); return j.id;
  };
  await manual("模拟期初资金", [{ code: "A-BANK", debit: "1000", credit: "0" }, { code: "E-EQUITY", debit: "0", credit: "1000" }]);

  const receiptRequest = { action: "receive", orderId, supplierId: IDS.supplierQinghe, materialId: IDS.materialD06, locationId: IDS.warehouse, colorName: "本色", qty: "100", reference: "SIM-RECEIPT-100", occurredOn: day, basis: "虚构实际收料100米", idempotencyKey: "simulation-receipt" };
  const receipt = await runMaterialCommand(manager, receiptRequest);
  await material({ action: "value_receipt", id: receipt.id, expectedVersion: 1, currency: "CNY", unitPrice: "2.50", basis: "模拟初始单价" });
  let receiptView = await getMaterialReceipt(manager, receipt.id);
  const ap = await trade({ action: "create_bill", orderId, direction: "payable", partyId: IDS.supplierQinghe, title: "模拟材料应付", category: "materials", currency: "CNY", amount: "250", dueDate: day, sourceKind: "receipt", sourceId: receipt.id, basis: "100米乘2.50" });
  await trade({ action: "confirm_bill", id: ap.id, expectedVersion: 1 });
  await fromSource("bill", ap.id, "A-INVENTORY", "L-AP");
  const transfer = await transferInventory({ ...manager, lotId: receiptView.lotId, qty: "60", toLocationId: IDS.factoryYunshan, idempotencyKey: key() });
  const use = await consumeInventory({ ...manager, lotId: transfer.toLotId!, orderId, qty: "40", idempotencyKey: key() });
  await material({ action: "return_use", id: use.movement.id, qty: "10", basis: "未耗用10米退回" });
  check("退回未耗用后的材料成本", (await getOrderCosts(manager, orderId)).currencies.find(c => c.currency === "CNY")!.materials, "75.00");
  const postAdjustments = async (billId: string, debit: string, credit: string) => {
    const changes = await prisma.tradeAdjustment.findMany({ where: { billId } });
    for (const a of changes) {
      const claim = await prisma.gLSourceClaim.findFirst({ where: { bookId: book.id, activeKey: "adjustment:" + a.id } });
      if (!claim) await fromSource("adjustment", a.id, debit, credit);
    }
  };
  await material({ action: "return_supplier", id: receipt.id, lotId: receiptView.lotId, qty: "20", basis: "未用材料退供20米" });
  let changed = await getReconciliationReport(manager, book.id);
  check("退供后来源变化被发现", changed.gaps.changedSources, 1);
  receiptView = await getMaterialReceipt(manager, receipt.id);
  await material({ action: "sync_payable", id: receipt.id, expectedVersion: receiptView.version, billId: ap.id, expectedBillVersion: (await getTradeBill(manager, ap.id)).version, basis: "退供扣减50元" });
  await postAdjustments(ap.id, "A-INVENTORY", "L-AP");
  await material({ action: "value_receipt", id: receipt.id, expectedVersion: receiptView.version, currency: "CNY", unitPrice: "3", basis: "模拟新单价3元，价差单独确认" });
  receiptView = await getMaterialReceipt(manager, receipt.id);
  await material({ action: "sync_payable", id: receipt.id, expectedVersion: receiptView.version, billId: ap.id, expectedBillVersion: (await getTradeBill(manager, ap.id)).version, basis: "80米净收料改价，补40元" });
  await postAdjustments(ap.id, "A-INVENTORY", "L-AP");
  await manual("模拟耗用成本30米乘3元", [{ code: "X-COST", debit: "90", credit: "0" }, { code: "A-INVENTORY", debit: "0", credit: "90" }]);
  check("材料净应付", (await getTradeBill(manager, ap.id)).amount, "240.00");

  // Start from the documented seed: 995 good, 980 already shipped; ship the remaining 15.
  const pack = await createPackingDraft({ ...manager, orderId, idempotencyKey: key(), cartons: [{ cartonNo: "SIM-LAST-15", lines: [{ colorName: "海军蓝", sizeCode: "S", quantity: 8 }, { colorName: "灰色", sizeCode: "M", quantity: 7 }] }] });
  await reject("未占用装箱方案不能出运", () => shipPackingPlan({ ...manager, planId: pack.plan.id, idempotencyKey: key() }), /占用|确认/);
  await occupyPackingPlan({ ...manager, planId: pack.plan.id, idempotencyKey: key() });
  const carton = await prisma.packingCarton.findFirstOrThrow({ where: { planId: pack.plan.id } });
  await recordCartonWeight({ ...manager, cartonId: carton.id, netWeight: "3", grossWeight: "3.5", claimed: "measured" });
  await shipPackingPlan({ ...manager, planId: pack.plan.id, idempotencyKey: key() });
  const shipped = await prisma.productionQty.aggregate({ where: { orderId, kind: "shipped" }, _sum: { quantity: true } });
  check("已出运数量", shipped._sum.quantity ?? 0, 995);
  const recon = await generateFactoryReconDraft({ ...manager, orderId, unitPriceYuan: "1", basisNote: "模拟每件加工费1元", idempotencyKey: key() });
  const factoryBill = await trade({ action: "create_bill", orderId, direction: "payable", partyId: IDS.factoryYunshan, title: "模拟加工应付", category: "processing", currency: "CNY", amount: recon.draft.amountYuan, dueDate: day, sourceKind: "recon", sourceId: recon.draft.id, basis: "按995件乘1元" });
  await trade({ action: "confirm_bill", id: factoryBill.id, expectedVersion: 1 }); await fromSource("bill", factoryBill.id, "X-COST", "L-AP");
  await trade({ action: "adjust_bill", id: factoryBill.id, expectedVersion: 2, amount: "-20", reason: "模拟加工扣款" }); await postAdjustments(factoryBill.id, "X-COST", "L-AP");
  const freight = await trade({ action: "create_bill", orderId, direction: "payable", partyId: IDS.supplierQinghe, title: "模拟运费", category: "other", currency: "CNY", amount: "40", dueDate: day, basis: "模拟运费依据" });
  await trade({ action: "confirm_bill", id: freight.id, expectedVersion: 1 });
  await material({ action: "tag_cost", id: freight.id, kind: "freight", active: true, basis: "明确归入本单运费" });
  const freightJournal = await fromSource("bill", freight.id, "X-COST", "L-AP");

  const pay = async (billId: string, partyId: string, amount: string, fee: string) => {
    const cash = await trade({ action: "record_cash", direction: "pay", partyId, currency: "CNY", amount, fee, bankAccount: "模拟人民币账户", bankReference: key(), occurredOn: day, basis: "虚构已发生付款" });
    await trade({ action: "allocate", billId, cashId: cash.id, cashAmount: amount, expectedBillVersion: (await getTradeBill(manager, billId)).version, expectedCashVersion: 1 });
    await fromSource("cash", cash.id, "L-AP", "A-BANK");
  };
  await pay(ap.id, IDS.supplierQinghe, "180", "2"); await pay(factoryBill.id, IDS.factoryYunshan, "600", "0");
  await trade({ action: "save_contract", orderId, currency: "USD", amount: "1000", tradeMode: "unknown", incoterm: "", terms: "模拟合同总价，不推定真实销售/税务确认政策", expectedVersion: 0 });
  const receivables: string[] = [];
  for (const [title, amount] of [["模拟订金", "300"], ["模拟尾款", "700"]]) {
    const bill = await trade({ action: "create_bill", orderId, direction: "receivable", title, category: title === "模拟订金" ? "deposit" : "balance", currency: "USD", amount, dueDate: day, packingPlanId: pack.plan.id, basis: "模拟已确认应收；收入分录仅供测试" });
    await trade({ action: "confirm_bill", id: bill.id, expectedVersion: 1 }); await fromSource("bill", bill.id, "A-AR", "R-INCOME", { rate: "7" }); receivables.push(bill.id);
  }
  const receiptCash = await trade({ action: "record_cash", direction: "receive", partyId: "customer-qinglan", currency: "USD", amount: "500", fee: "10", bankAccount: "模拟美元账户", bankReference: "SIM-USD-500", occurredOn: day, basis: "虚构本金500美元，手续费10美元" });
  await fromSource("cash", receiptCash.id, "A-BANK", "L-ADVANCE", { rate: "7" });
  await trade({ action: "allocate", billId: receivables[0], cashId: receiptCash.id, cashAmount: "300", expectedBillVersion: 2, expectedCashVersion: 1 });
  await manual("模拟核销300美元转应收，明确采用7", [{ code: "L-ADVANCE", debit: "2100", credit: "0" }, { code: "A-AR", debit: "0", credit: "2100" }]);
  const refund = await treasury({ action: "record_refund", sourceCashId: receiptCash.id, expectedVersion: 2, amount: "50", fee: "0", bankAccount: "模拟美元账户", bankReference: "SIM-REFUND-50", occurredOn: day, basis: "虚构退还未分配客户款50美元" });
  await fromSource("refund", refund.id, "L-ADVANCE", "A-BANK", { rate: "7" });
  const fx = await treasury({ action: "record_fx", sourceCashId: receiptCash.id, expectedVersion: 3, amount: "200", toCurrency: "CNY", rate: "7.1", fee: "20", toAccount: "模拟人民币账户", bankReference: "SIM-FX-200", occurredOn: day, rateDate: day, basis: "虚构200美元换1420元，手续费20元" });
  await fromSource("fx", fx.id, "A-BANK", "A-BANK", { carryingAmount: "1400" });
  await reject("超可分配本金退款拒绝", () => treasury({ action: "record_refund", sourceCashId: receiptCash.id, expectedVersion: 4, amount: "160", fee: "0", bankAccount: "模拟美元账户", bankReference: "SIM-BAD-REFUND", occurredOn: day, basis: "超额验收" }), /超过|余额|来源/);
  await reject("超过来源净额的换汇拒绝", () => treasury({ action: "record_fx", sourceCashId: receiptCash.id, expectedVersion: 4, amount: "241", toCurrency: "CNY", rate: "7.1", fee: "0", toAccount: "模拟人民币账户", bankReference: "SIM-BAD-FX", occurredOn: day, rateDate: day, basis: "超额验收" }), /超过|余额|来源/);
  const reused = await runMaterialCommand(manager, receiptRequest); check("重复收料复用原凭证", reused.id, receipt.id);
  check("原收款可分配余额与结汇分开", (await listTradeCash(manager)).rows.find(r => r.id === receiptCash.id)!.unallocatedAmount, "150.00");
  const reportBeforeReversal = await getReconciliationReport(manager, book.id);
  for (const [role, amount] of [["receivable", "4900.00"], ["payable", "475.00"], ["funds", "2298.00"], ["cost", "1105.00"]]) {
    const row = reportBeforeReversal.rows.find(r => r.role === role)!;
    check(role + "业务金额", row.business!, amount); check(role + "总账核对额", row.actual!, amount); check(role + "差异", row.difference!, "0.00");
  }
  check("全部有效业务来源金额一致", reportBeforeReversal.sourceReport.counts.matched, 13);
  check("来源待处理数量", reportBeforeReversal.gaps.pendingSources, 0);
  const reversed = await gl({ action: "reverse_journal", id: freightJournal, expectedVersion: 3, date: day, reason: "模拟冲销与重新入账" }); await post(reversed.id);
  changed = await getReconciliationReport(manager, book.id);
  check("冲销后差异被发现", changed.rows.find(r => r.role === "payable")!.difference!, "-40.00");
  await fromSource("bill", freight.id, "X-COST", "L-AP");
  const report = await getReconciliationReport(manager, book.id), cost = await getOrderCosts(manager, orderId), trial = await getLedgerTrial(manager, book.id, "2026-09");
  const cny = cost.currencies.find(c => c.currency === "CNY")!;
  check("材料净耗用成本", cny.materials, "90.00"); check("加工成本", cny.processing, "975.00"); check("其他费用", cny.other, "40.00"); check("本单已知成本", cny.total, "1105.00");
  for (const [code, side, amount] of [["A-INVENTORY","closingDebit","150.00"],["A-BANK","closingDebit","3298.00"],["A-AR","closingDebit","4900.00"],["L-AP","closingCredit","475.00"],["L-ADVANCE","closingCredit","1050.00"],["X-FEE","closingDebit","92.00"],["X-FX","closingCredit","20.00"]]) check("试算表 " + code, trial.rows.find(r => r.code === code)![side as "closingDebit" | "closingCredit"], amount);
  assert(trial.balanced); check("重制单后来源待处理", report.gaps.pendingSources, 0);
  await gl({ action: "close_period", bookId: book.id, month: "2026-09", reason: "模拟验收，仅确认本案例已制单记录，不作为真实财务结账" });
  await reject("关闭期间拒绝新增凭证", () => gl({ action: "save_journal", bookId: book.id, date: day, summary: "应被阻止", basis: "关闭期间验收", expectedVersion: 0, lines: [{ accountId: account("A-BANK"), debit: "1", credit: "0", note: "" }, { accountId: account("E-EQUITY"), debit: "0", credit: "1", note: "" }] }), /关闭/);
  check("已过账凭证数量", await prisma.gLJournal.count({ where: { bookId: book.id, status: "posted" } }), 18);
  return { mode: "ISOLATED_SIMULATION", bookId: book.id, orderId, day, checks, blocked, rows: report.rows, sourceCounts: report.sourceReport.counts, gaps: report.gaps, trialBalanced: trial.balanced, trialTotals: trial.totals, trialRows: trial.rows, periodClosed: true,
    assumptions: ["沿用演示订单已合格995件、已出运980件的起始事实，本次补发15件；未重跑款式开发与生产全链。", "USD往来和核对汇率统一采用7；实际换汇示例7.1；这些不是企业真实政策。", "将本例应收对应收入只作为模拟映射；实际收入/税务确认尚待财务。", "期初资金1000、材料耗用90及核销300美元的会计处理用明确手工凭证补齐，未宣称自动映射。", "资金核对额2298是登记净变动；试算表资金3298含手工期初1000，未验银行外部余额。", "只有公司总额一致，逐往来/银行辅助明细、真实税务、期初真实性仍待确认。"] };
}
