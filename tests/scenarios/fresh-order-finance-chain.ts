import assert from "node:assert/strict";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { createStyleMaster } from "@/server/services/style-create";
import { createMaterialMaster } from "@/server/services/material-create";
import { createOralOrderDraft } from "@/server/services/oral-order";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { saveOrderPrep } from "@/server/services/order-prep";
import { approveOrderSpec } from "@/server/services/style-version";
import { submitColorConfirmation } from "@/server/services/color-confirm";
import { releaseToProduction } from "@/server/services/execution";
import { recordProductionQty } from "@/server/services/production-board";
import { createPackingDraft } from "@/server/services/packing";
import { transferInventory, consumeInventory } from "@/server/services/inventory-move";
import { runMaterialCommand } from "@/server/services/material-write";
import { getMaterialReceipt, getOrderCosts } from "@/server/services/material-read";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill } from "@/server/services/trade-read";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { getLedgerTrial } from "@/server/services/ledger-read";
import { setUserPermission } from "@/server/services/user-permissions";
import { saveReconciliationRule } from "@/server/services/reconciliation-rules";
import { getReconciliationReport } from "@/server/services/reconciliation-report";

const DAY = "2026-09-20";

/** Isolated test.db only. Starts from a new style + oral order, not order-demo-005. */
export async function simulateFreshOrderFinanceChain() {
  assert.match(process.env.DATABASE_URL ?? "", /test\.db$/, "Fresh chain must use isolated test.db");
  const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
  const sales = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
  const checks: Array<{ name: string; expected: string; actual: string }> = [];
  const blocked: Array<{ name: string; result: string }> = [];
  let sequence = 0;
  const key = () => `fresh-chain-${++sequence}`;
  const check = (name: string, actual: string | number, expected: string | number) => {
    assert.equal(actual, expected, name);
    checks.push({ name, expected: String(expected), actual: String(actual) });
  };
  const reject = async (name: string, operation: () => Promise<unknown>, message: RegExp) => {
    let error: unknown;
    try {
      await operation();
    } catch (e) {
      error = e;
    }
    assert(error instanceof Error && message.test(error.message), name);
    blocked.push({ name, result: (error as Error).message });
  };

  const stylesBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
  await reject(
    "工厂不能口头建单",
    () =>
      createOralOrderDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        customerId: IDS.customerNorthshore,
        styleId: IDS.styleSt26018,
        colors: [{ colorName: "海军蓝", quantity: 10 }],
      }),
    /无权/,
  );

  const style = await createStyleMaster({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    code: "ST-CHAIN-01",
    name: "隔离整链针织上衣",
    category: "针织上衣",
    silhouette: "圆领",
  });
  const material = await createMaterialMaster({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    code: "MAT-CHAIN-01",
    name: "整链演示汗布",
    kind: "fabric",
    specSummary: "隔离案例新建，不是库存",
    unit: "m",
  });
  check("新建主档后款数加一", await prisma.style.count({ where: { organizationId: IDS.orgDemo } }), stylesBefore + 1);

  const oral = await createOralOrderDraft({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    customerId: IDS.customerNorthshore,
    styleId: style.styleId,
    factoryId: IDS.factoryYunshan,
    colors: [
      { colorName: "海军蓝", quantity: 20 },
      { colorName: "灰色", quantity: 10 },
    ],
    externalCustomerPo: "",
    deliveryText: "10 月口头交期",
    note: "隔离整链，不是脏库补发",
    idempotencyKey: "fresh-oral-st-chain-01",
  });
  const again = await createOralOrderDraft({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    customerId: IDS.customerNorthshore,
    styleId: style.styleId,
    colors: [{ colorName: "海军蓝", quantity: 1 }],
    idempotencyKey: "fresh-oral-st-chain-01",
  });
  check("口头建单幂等复用", again.orderId, oral.orderId);
  check("不是脏库 DEMO-ORD-005", oral.orderId === "order-demo-005" ? "yes" : "no", "no");
  const orderId = oral.orderId;

  await saveStyleBomDraft({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    styleId: style.styleId,
    materialIds: [material.materialId],
    consumptions: { [material.materialId]: "0.5" },
  });

  const stamp = async () => (await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } })).updatedAt.toISOString();
  await saveOrderPrep({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    orderId,
    sizes: [
      { colorName: "海军蓝", breakdown: { S: 8, M: 12 } },
      { colorName: "灰色", breakdown: { S: 4, M: 6 } },
    ],
    confirmedDeliveryDate: "2026-10-15",
    ribSpec: "2x2 罗纹，隔离案例口头规格",
    expectedUpdatedAt: await stamp(),
  });
  const approved = await approveOrderSpec({
    organizationId: IDS.orgDemo,
    userId: IDS.userManager,
    role: "manager",
    orderId,
    expectedUpdatedAt: await stamp(),
  });
  check("资料版本已批准", approved.versionStatus, "approved");
  check("批准后仍不是可投产", approved.productionReadiness === "ready_for_production" ? "yes" : "no", "no");
  for (const colorName of ["海军蓝", "灰色"]) {
    await submitColorConfirmation({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      materialId: material.materialId,
      colorName,
      status: "approved",
      evidence: "隔离案例分色确认，不沿用旧样品",
    });
  }
  await reject("正式投产仍关闭", () => releaseToProduction({ ...manager, orderId }), /投产/);

  const receipt = await runMaterialCommand(manager, {
    action: "receive",
    orderId,
    supplierId: IDS.supplierQinghe,
    materialId: material.materialId,
    locationId: IDS.warehouse,
    colorName: "本色",
    qty: "40",
    reference: "FRESH-RECEIPT-40",
    occurredOn: DAY,
    basis: "隔离案例收料40米",
    idempotencyKey: "fresh-receipt-40",
  });
  await runMaterialCommand(manager, { action: "value_receipt", id: receipt.id, expectedVersion: 1, currency: "CNY", unitPrice: "2.00", basis: "隔离单价2元", idempotencyKey: key() });
  const receiptView = await getMaterialReceipt(manager, receipt.id);
  const transfer = await transferInventory({ ...manager, lotId: receiptView.lotId, qty: "25", toLocationId: IDS.factoryYunshan, idempotencyKey: key() });
  await consumeInventory({ ...manager, lotId: transfer.toLotId!, orderId, qty: "15", idempotencyKey: key() });
  check("领用后材料成本", (await getOrderCosts(manager, orderId)).currencies.find((row) => row.currency === "CNY")!.materials, "30.00");

  const qtyLines = [
    { colorName: "海军蓝", sizeCode: "S", quantity: 8 },
    { colorName: "海军蓝", sizeCode: "M", quantity: 12 },
    { colorName: "灰色", sizeCode: "S", quantity: 4 },
    { colorName: "灰色", sizeCode: "M", quantity: 6 },
  ];
  await reject(
    "未正式投产不能登记产量",
    () =>
      recordProductionQty({ ...manager, orderId, kind: "started", quantity: 30, lines: qtyLines, idempotencyKey: "fresh-started-30" }),
    /投产阻塞/,
  );
  await reject(
    "没有合格产量不能装箱",
    () =>
      createPackingDraft({
        ...manager,
        orderId,
        idempotencyKey: key(),
        cartons: [{ cartonNo: "FRESH-30", lines: qtyLines }],
      }),
    /可用成品|投产/,
  );
  const shipped = await prisma.productionQty.aggregate({ where: { orderId, kind: "shipped" }, _sum: { quantity: true } });
  check("未投产所以没有出运", shipped._sum.quantity ?? 0, 0);

  for (const action of ["ledger_view", "ledger_review", "trade_view"]) {
    await setUserPermission({ organizationId: manager.organizationId, managerId: manager.userId, targetUserId: sales.userId, action, enabled: true });
  }
  let n = 0;
  const gl = (input: Record<string, unknown>, actor = manager) => runLedgerCommand(actor, { ...input, idempotencyKey: `fresh-gl-${++n}` });
  const trade = (input: Record<string, unknown>) => runTradeCommand(manager, { ...input, idempotencyKey: `fresh-trade-${++n}` });
  const book = await gl({ action: "create_book", name: "新输入整链账簿", baseCurrency: "CNY", startMonth: "2026-09" });
  const accounts = await prisma.gLAccount.findMany({ where: { bookId: book.id } });
  const account = (code: string) => accounts.find((row) => row.code === code)!.id;
  await saveReconciliationRule(manager, {
    action: "save_reconciliation_rule",
    bookId: book.id,
    expectedVersion: 0,
    idempotencyKey: key(),
    accounts: { receivable: [account("A-AR")], payable: [account("L-AP")], funds: [account("A-BANK")], cost: [account("X-COST")] },
    rates: [],
    basis: "隔离新输入案例；人民币本币，不作为企业会计政策",
  });
  const post = async (id: string) => {
    await gl({ action: "review_journal", id, expectedVersion: 1 }, sales);
    await gl({ action: "post_journal", id, expectedVersion: 2 });
  };
  const fromSource = async (type: string, id: string, debit: string, credit: string) => {
    const journal = await gl({
      action: "from_source",
      bookId: book.id,
      date: DAY,
      sourceType: type,
      sourceId: id,
      debitAccountId: account(debit),
      creditAccountId: account(credit),
      feeAccountId: account("X-FEE"),
      gainLossAccountId: account("X-FX"),
      rate: "1",
      rateDate: DAY,
      basis: "隔离案例演示映射，非已确认会计规则",
    });
    await post(journal.id);
    return journal.id;
  };
  const manual = async (summary: string, lines: Array<{ code: string; debit: string; credit: string }>) => {
    const journal = await gl({
      action: "save_journal",
      bookId: book.id,
      date: DAY,
      summary,
      basis: "隔离案例手工补齐耗用，待确认存货计价",
      expectedVersion: 0,
      lines: lines.map((line) => ({ accountId: account(line.code), debit: line.debit, credit: line.credit, note: summary })),
    });
    await post(journal.id);
  };

  const materialBill = await trade({
    action: "create_bill",
    orderId,
    direction: "payable",
    partyId: IDS.supplierQinghe,
    title: "整链材料应付",
    category: "materials",
    currency: "CNY",
    amount: "80",
    dueDate: DAY,
    sourceKind: "receipt",
    sourceId: receipt.id,
    basis: "40米乘2.00",
  });
  await trade({ action: "confirm_bill", id: materialBill.id, expectedVersion: 1 });
  await fromSource("bill", materialBill.id, "A-INVENTORY", "L-AP");
  await manual("隔离耗用15米乘2元", [
    { code: "X-COST", debit: "30", credit: "0" },
    { code: "A-INVENTORY", debit: "0", credit: "30" },
  ]);
  await trade({
    action: "save_contract",
    orderId,
    currency: "CNY",
    amount: "300",
    tradeMode: "unknown",
    incoterm: "",
    terms: "隔离案例合同总价，不推定真实销售确认",
    expectedVersion: 0,
  });
  const receivable = await trade({
    action: "create_bill",
    orderId,
    direction: "receivable",
    title: "整链货款",
    category: "balance",
    currency: "CNY",
    amount: "300",
    dueDate: DAY,
    basis: "隔离已确认应收，收入时点待确认；本单尚未出运",
  });
  await trade({ action: "confirm_bill", id: receivable.id, expectedVersion: 1 });
  await fromSource("bill", receivable.id, "A-AR", "R-INCOME");

  const pay = await trade({
    action: "record_cash",
    direction: "pay",
    partyId: IDS.supplierQinghe,
    currency: "CNY",
    amount: "50",
    fee: "0",
    bankAccount: "隔离人民币账户",
    bankReference: "FRESH-PAY-50",
    occurredOn: DAY,
    basis: "虚构已付款50",
  });
  await trade({
    action: "allocate",
    billId: materialBill.id,
    cashId: pay.id,
    cashAmount: "50",
    expectedBillVersion: (await getTradeBill(manager, materialBill.id)).version,
    expectedCashVersion: 1,
  });
  await fromSource("cash", pay.id, "L-AP", "A-BANK");
  const incoming = await trade({
    action: "record_cash",
    direction: "receive",
    partyId: IDS.customerNorthshore,
    currency: "CNY",
    amount: "200",
    fee: "0",
    bankAccount: "隔离人民币账户",
    bankReference: "FRESH-RCV-200",
    occurredOn: DAY,
    basis: "虚构已收款200",
  });
  await trade({
    action: "allocate",
    billId: receivable.id,
    cashId: incoming.id,
    cashAmount: "200",
    expectedBillVersion: (await getTradeBill(manager, receivable.id)).version,
    expectedCashVersion: 1,
  });
  await fromSource("cash", incoming.id, "A-BANK", "A-AR");

  const report = await getReconciliationReport(manager, book.id);
  const trial = await getLedgerTrial(manager, book.id, "2026-09");
  const cost = (await getOrderCosts(manager, orderId)).currencies.find((row) => row.currency === "CNY")!;
  for (const [role, amount] of [
    ["receivable", "100.00"],
    ["payable", "30.00"],
    ["funds", "150.00"],
    ["cost", "30.00"],
  ] as const) {
    const row = report.rows.find((item) => item.role === role)!;
    check(`${role}业务金额`, row.business!, amount);
    check(`${role}总账核对额`, row.actual!, amount);
    check(`${role}差异`, row.difference!, "0.00");
  }
  check("材料成本", cost.materials, "30.00");
  check("加工成本", cost.processing, "0.00");
  check("本单已知成本", cost.total, "30.00");
  assert(trial.balanced);
  check("试算平衡", trial.balanced ? "yes" : "no", "yes");

  return {
    mode: "ISOLATED_FRESH_CHAIN",
    bookId: book.id,
    orderId,
    orderNo: oral.orderNo,
    styleId: style.styleId,
    styleCode: style.styleCode,
    materialId: material.materialId,
    checks,
    blocked,
    rows: report.rows,
    trialBalanced: trial.balanced,
    assumptions: [
      "从新建主档和口头建单开始，不使用 order-demo-005 的已出运余量。",
      "正式投产仍关闭：产量和装箱都被真实规则挡住，没有改成可投产凑出运。",
      "收付是已发生登记，不是银行执行；入账映射是演示科目，不是企业会计政策。",
      "耗用成本用手工作业补齐，存货计价待确认。",
    ],
  };
}
