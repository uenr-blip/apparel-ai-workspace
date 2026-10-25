import { workflowTools } from "@/server/agents/workflow-tools";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { listLedgerBridge } from "@/server/services/ledger-bridge";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { expenseSubject, getStageExpenses } from "@/server/services/stage-expenses";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill, getTradeOverview, listTradeDocuments, listTradeBills } from "@/server/services/trade-read";
import { exportTrade } from "@/server/services/trade-export";
import { tradeLookup } from "@/server/services/trade-lookup";
import { setUserPermission } from "@/server/services/user-permissions";
import { getStageWorkspace, saveStageMaterials, previewStageTransfer, confirmStageTransfer } from "@/server/services/workflow-stage";
import { getPatternBoard, patternCommand } from "@/server/services/pattern-workflow";
import { readLedgerSource } from "@/server/services/ledger-source";
import { persistFollowRows } from "@/server/services/follow-records";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const key = () => crypto.randomUUID();
const run = (data: Record<string, unknown>, who = actor) => runTradeCommand(who, { ...data, idempotencyKey: data.idempotencyKey ?? key() });
async function project() {
  return prisma.developmentProject.create({ data: { id: key(), organizationId: IDS.orgDemo, code: `DEV-${key()}`, name: "阶段费用验证款", styleId: IDS.styleSt26018, status: "open", unknownsJson: "[]", craftFamily: "knit", customerId: IDS.customerNorthshore } });
}
async function expense(target: { projectId?: string; followRowId?: string }, overrides: Record<string, unknown> = {}) {
  const s = await expenseSubject(actor, target);
  return { action: "create_stage_expense", ...target, expectedStamp: s.stamp, partyId: IDS.factoryYunshan, title: "头版加工费", expenseKind: "sampling", amount: "100.50", currency: "CNY", dueDate: "2026-10-10", expenseDate: "2026-09-28", expenseReference: key(), basis: "打样报价单及收到样衣核对", ...overrides };
}
async function transfer(target: { projectId?: string; followRowId?: string }, patternRevisionId?: string) {
  const input = { target, patternRevisionId, title: "费用接续验证", batchKey: key(), customerId: IDS.customerNorthshore, factoryId: IDS.factoryYunshan, ownerId: actor.userId, seasonCode: "SS27", basis: "客户已核对本阶段要求" };
  const preview = await previewStageTransfer(actor, input);
  const result = await confirmStageTransfer(actor, input, preview.stamp, key(), true);
  return prisma.orderMerchStyle.findFirstOrThrow({ where: { sheetId: result.sheetId } });
}
beforeEach(resetDatabase);
describe("发生阶段费用 → 原应付与收付核销", () => {
  it("不建生产单，保存凭据缩略来源、确认、部分付款核销及撤回，旧费用留存", async () => {
    const p = await project(), count = await prisma.salesOrder.count();
    const command = { ...await expense({ projectId: p.id }), idempotencyKey: key() };
    const upload = { filename: "样衣费用.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nQA fixture") };
    const created = await runTradeCommand(actor, command, upload);
    expect(await runTradeCommand(actor, command, upload)).toMatchObject({ id: created.id, reused: true });
    expect(await prisma.salesOrder.count()).toBe(count);
    expect((await getTradeOverview(actor)).currencies).toHaveLength(0);
    const docs = await listTradeDocuments(actor, { billId: created.id });
    expect(docs.rows).toHaveLength(1); expect(docs.rows[0]).toMatchObject({ orderId: null, filename: "样衣费用.pdf", billId: created.id });
    let bill = await getTradeBill(actor, created.id); expect(bill.businessHref).toBe(`/projects/${p.id}#stage-expenses`);
    await run({ action: "confirm_bill", id: bill.id, expectedVersion: bill.version });
    expect((await getTradeOverview(actor)).currencies[0].payable).toBe("100.50");
    const cash = await run({ action: "record_cash", direction: "pay", partyId: IDS.factoryYunshan, currency: "CNY", amount: "80", fee: "0", bankAccount: "测试账户", bankReference: key(), occurredOn: "2026-09-28", basis: "人工核对已付款回单" });
    const allocation = await run({ action: "allocate", billId: bill.id, cashId: cash.id, cashAmount: "80", expectedBillVersion: 2, expectedCashVersion: 1 });
    bill = await getTradeBill(actor, bill.id); expect(bill.openAmount).toBe("20.50");
    const book = await runLedgerCommand(actor, { action: "create_book", idempotencyKey: key(), name: "阶段费用验证账簿", baseCurrency: "CNY", startMonth: "2026-09" });
    expect((await listLedgerBridge(actor, book.id, { billId: bill.id })).rows).toEqual(expect.arrayContaining([expect.objectContaining({ id: bill.id, state: "ready", orderId: null })]));
    expect(await readLedgerSource(prisma, actor.organizationId, "bill", bill.id)).toMatchObject({ amount: BigInt(10050), direction: "payable" });
    await expect(run({ action: "void_bill", id: bill.id, expectedVersion: bill.version, reason: "录入有误" })).rejects.toThrow(/核销/);
    await run({ action: "reverse_allocation", id: allocation.id, reason: "核对后更正分配" });
    expect((await getTradeBill(actor, bill.id)).openAmount).toBe("100.50");
    expect((await exportTrade(actor, "bills", { projectId: p.id, stageOnly: "1" })).csv).toContain(command.expenseReference);
    expect(await prisma.auditEvent.count({ where: { entityId: bill.id, action: "trade.create_stage_expense" } })).toBe(1);
  });
  it("开发费用在销售样与大货仅沿真实交接回查，同款另建不复制费用", async () => {
    const p = await project(), target = { projectId: p.id };
    const b = await getStageWorkspace(actor, target);
    await saveStageMaterials(actor, { target, expectedStamp: b.stamp, rows: [{ key: "fabric", group: "fabric", name: "测试棉布", fields: { composition: "100%棉", unit: "m" } }], reason: "头版用料", ownerId: actor.userId, requestKey: key() });
    const board = await getPatternBoard(actor, p.id);
    await patternCommand(actor, p.id, { action: "freeze", reason: "头版", idempotencyKey: key(), expectedUpdatedAt: board.updatedAt, contextStamp: board.contextStamp, confirmed: true });
    const revision = await prisma.patternRevision.findFirstOrThrow({ where: { projectId: p.id } });
    const first = await run(await expense(target));
    const sales = await transfer(target, revision.id), second = await run(await expense({ followRowId: sales.id }, { title: "寄销售样费", expenseKind: "delivery" }));
    const bulk = await transfer({ followRowId: sales.id });
    const result = await getStageExpenses(actor, { followRowId: bulk.id });
    expect(result.rows.map(r => r.id).sort()).toEqual([first.id, second.id].sort()); expect(result.rows.every(r => r.inherited)).toBe(true);
    expect(await prisma.tradeBill.count()).toBe(2);
    const tools = workflowTools(actor), tool = tools.tools.find(t => t.name === "read_stage_expenses")!;
    const evidence = await tool.run({ followRowId: bulk.id }) as { records: Array<{ id: string; inherited: boolean }> };
    expect(evidence.records.map(r => r.id).sort()).toEqual([first.id, second.id].sort());
    expect(tools.tables[0].notes?.join("")).toContain("未复制或分摊");
    expect((await getStageExpenses(actor, { projectId: (await project()).id })).rows).toHaveLength(0);
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: sales.sheetId }, include: { styles: true } });
    const styles = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
    await expect(prisma.$transaction(db => persistFollowRows(db, sheet.id, []))).rejects.toThrow(/费用/);
    styles[0].styleCode = "OTHER";
    await expect(prisma.$transaction(db => persistFollowRows(db, sheet.id, styles))).rejects.toThrow(/费用/);
  });
  it("重复凭据、过期所属资料、归档、无归属与跨组织不能登记", async () => {
    const p = await project(), input = await expense({ projectId: p.id });
    await run(input); await expect(run(input)).rejects.toThrow(/相同费用凭据号/);
    await expect(run({ ...input, expenseReference: key(), projectId: "" })).rejects.toThrow(/唯一/);
    await expect(run({ ...input, expenseReference: key(), projectId: "foreign" })).rejects.toThrow(/不存在/);
    await prisma.developmentProject.update({ where: { id: p.id }, data: { name: "改名" } });
    await expect(run({ ...input, expenseReference: key() })).rejects.toThrow(/变化/);
    await prisma.developmentProject.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
    await expect(run(await expense({ projectId: p.id }))).rejects.toThrow(/归档/);
    expect(await prisma.tradeBill.count()).toBe(1);
  });
  it("沿用财务权限，普通跟单员、工厂和撤权者不能查写", async () => {
    const p = await project(), input = await expense({ projectId: p.id }), employee = { ...actor, userId: IDS.userSales, role: "salesperson" };
    await expect(run(input, employee)).rejects.toThrow(/无权/);
    await expect(getStageExpenses({ ...actor, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan }, { projectId: p.id })).rejects.toThrow(/无权/);
    await expect(expenseSubject({ ...actor, organizationId: IDS.orgIso }, { projectId: p.id })).rejects.toThrow(/无权/);
    for (const action of ["trade_view", "trade_prepare"]) await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action, enabled: true });
    expect(await tradeLookup(employee, { kind: "expense_projects", q: "阶段费用验证款" })).toHaveLength(1);
    await run(input, employee);
    const bill = (await listTradeBills(actor, { projectId: p.id })).rows[0];
    await expect(run({ action: "confirm_bill", id: bill.id, expectedVersion: 1 }, employee)).rejects.toThrow(/无权/);
    await setUserPermission({ organizationId: actor.organizationId, managerId: actor.userId, targetUserId: employee.userId, action: "trade_view", enabled: false });
    await expect(getStageExpenses(employee, { projectId: p.id })).rejects.toThrow(/无权/);
  });
  it("单证与流水关联必须属于本笔费用及同一往来方", async () => {
    const p = await project(), c = await run(await expense({ projectId: p.id }));
    await expect(run({ action: "add_document", billId: c.id, orderId: "order-demo-005", kind: "other", number: "错关联", issuedOn: "2026-09-28", note: "错误订单" })).rejects.toThrow(/不属于/);
    await expect(run({ action: "add_document", billId: "", orderId: "", kind: "other", number: "无来源", issuedOn: "2026-09-28", note: "" })).rejects.toThrow(/请选择/);
    await run({ action: "confirm_bill", id: c.id, expectedVersion: 1 });
    const cash = await run({ action: "record_cash", direction: "pay", partyId: IDS.supplierQinghe, currency: "CNY", amount: "1000", fee: "0", bankAccount: "测试", bankReference: key(), occurredOn: "2026-09-28", basis: "测试回单" });
    await expect(run({ action: "add_document", billId: c.id, cashId: cash.id, kind: "bank_receipt", number: "错误回单", issuedOn: "2026-09-28", note: "" })).rejects.toThrow(/往来方/);
    await expect(run({ action: "allocate", billId: c.id, cashId: cash.id, cashAmount: "100", expectedBillVersion: 2, expectedCashVersion: 1 })).rejects.toThrow(/往来方/);
    expect(await prisma.tradeDocument.count()).toBe(0); expect(await prisma.tradeAllocation.count()).toBe(0);
  });
});
