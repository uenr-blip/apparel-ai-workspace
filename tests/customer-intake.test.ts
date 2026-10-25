import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { ingestText } from "@/server/services/intake";
import * as intakeService from "@/server/services/intake";
import { emptyIntakeDraft } from "@/lib/customer-intake";
import { confirmIntakeDraft, getCustomerIntake, intakeCatalog, prepareCustomerIntake, saveIntakeDraft } from "@/server/services/customer-intake";
import { summarizeDecision } from "@/server/services/workspace";
import { getDecisionRecord } from "@/server/services/decision-center";
import { listFollowProducts, openFollowAsOrder } from "@/server/services/order-merch";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import type { Completion } from "@/server/agents/runtime";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
const raw = "北岸服饰 PO100519 大货，云杉服装工厂，SS27。采购日期2026-09-09，出货2026-10-31。ST-26018 产品编号00186700 Sweatshirt。海军蓝600件，灰色400件。袖口改罗纹，规格稍后核对。";
beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());
async function source() { return (await ingestText({ ...actor, text: raw, origin: "inbox-paste" })).source.id; }
function draft() {
  const value = emptyIntakeDraft(); Object.assign(value, { title: "SS27 客户 PO", customerId: IDS.customerNorthshore, factoryId: IDS.factoryYunshan, po: "PO100519", seasonCode: "SS27", purchaseDate: "2026-09-09", shipDate: "2026-10-31" });
  Object.assign(value.items[0], { styleId: IDS.styleSt26018, styleName: "Sweatshirt", productCode: "00186700", craftFamily: "knit", note: "袖口改罗纹，规格稍后核对", colors: [{ name: "海军蓝", quantity: "600" }, { name: "灰色", quantity: "400" }, { name: "黑色", quantity: "不下" }] }); return value;
}
async function saved() { const sourceId = await source(); const result = await saveIntakeDraft(actor, { sourceId, jobId: null, expectedProposalId: null, draft: draft() }); return { sourceId, ...result }; }
it("客户PO→可编辑草稿→确认跟单→总表→按原流程开单，保留编号/PO/原件/审计且不自动投产", async () => {
  const before = { orders: await prisma.salesOrder.count(), purchases: await prisma.purchaseDraft.count(), styles: await prisma.style.count() };
  const input = await saved();
  const proposal = await prisma.actionProposal.findUniqueOrThrow({ where: { id: input.proposalId } });
  expect(summarizeDecision(proposal).href).toBe(`/inbox/${input.sourceId}`);
  expect((await getDecisionRecord(actor.organizationId, input.proposalId)).reviewInInbox).toBe(true);
  const result = await confirmIntakeDraft(actor, { ...input, confirmed: true });
  expect((await confirmIntakeDraft(actor, { ...input, confirmed: true })).sheetId).toBe(result.sheetId);
  expect(await prisma.salesOrder.count()).toBe(before.orders); expect(await prisma.purchaseDraft.count()).toBe(before.purchases); expect(await prisma.style.count()).toBe(before.styles);
  const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: result.sheetId }, include: { styles: true } });
  const rows = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
  expect(rows[0].salesSample.numericCode).toBe("00186700"); expect(rows[0].bulk.po).toBe("PO100519"); expect(rows[0].bulk.purchaseDate).toBe("2026-09-09"); expect(rows[0].bulk.colors[2].qtyText).toBe("不下");
  expect((await intakeCatalog(actor)).styles.find(s => s.id === IDS.styleSt26018)?.productCodes).toContain("00186700");
  expect((await getCustomerIntake(actor, input.sourceId)).result?.sheetId).toBe(result.sheetId);
  const list = (await listFollowProducts(actor.organizationId, actor)).bulk.flatMap(g => g.styles);
  expect(list.find(r => r.key.startsWith(result.sheetId))?.po).toBe("PO100519");
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "intake.follow_created", entityId: input.sourceId } });
  expect(audit.actorUserId).toBe(actor.userId); expect(audit.createdAt).toBeInstanceOf(Date); expect(JSON.parse(audit.payloadJson!).after.draft.items[0].colors[0].quantity).toBe("600");
  const customer = await prisma.customer.create({ data: { id: "other-customer", organizationId: actor.organizationId, code: "OTHER", name: "其他客户", demoNote: "test" } });
  await expect(openFollowAsOrder({ ...actor, sheetId: sheet.id, customerId: customer.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), idempotencyKey: "wrong-customer" })).rejects.toThrow(/客户与收件箱/);
  expect(await prisma.salesOrder.count()).toBe(before.orders);
  expect(await prisma.orderMerchSheet.findUnique({ where: { id: sheet.id }, include: { styles: true } })).toEqual(sheet);
  const order = await openFollowAsOrder({ ...actor, sheetId: sheet.id, customerId: IDS.customerNorthshore, expectedUpdatedAt: sheet.updatedAt.toISOString(), idempotencyKey: "open-intake-order" });
  const actual = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.orderId }, include: { source: true, lines: true } });
  expect(actual.externalCustomerPo).toBe("PO100519"); expect(actual.lines[0].totalQuantity).toBe(1000); expect(actual.productionReadiness).toBe("blocked_incomplete_spec"); expect(JSON.parse(actual.source!.rawText).intakeSourceId).toBe(input.sourceId);
  expect((await ingestText({ ...actor, text: raw, origin: "inbox-paste" })).alreadyExisted).toBe(true);
});
it("人工改稿保留前后值，旧确认和并发旧版本失效；缺项可保存但不能确认", async () => {
  const old = await saved(); const next = draft(); next.items[0].colors[0].quantity = "650";
  const edited = await saveIntakeDraft(actor, { sourceId: old.sourceId, jobId: old.jobId, expectedProposalId: old.proposalId, draft: next });
  await expect(confirmIntakeDraft(actor, { ...old, confirmed: true })).rejects.toThrow(/失效/);
  await expect(saveIntakeDraft(actor, { sourceId: old.sourceId, jobId: old.jobId, expectedProposalId: old.proposalId, draft: next })).rejects.toThrow(/其他人/);
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "intake.draft_saved", payloadJson: { contains: edited.proposalId } } });
  expect(JSON.parse(audit.payloadJson!).before.items[0].colors[0].quantity).toBe("600"); expect(JSON.parse(audit.payloadJson!).after.items[0].colors[0].quantity).toBe("650");
  next.factoryId = ""; const partial = await saveIntakeDraft(actor, { sourceId: old.sourceId, jobId: old.jobId, expectedProposalId: edited.proposalId, draft: next });
  expect(partial.missing).toContain("负责工厂"); await expect(confirmIntakeDraft(actor, { sourceId: old.sourceId, ...partial, confirmed: true })).rejects.toThrow(/负责工厂/);
});
it("租户、角色、确认人、关联主档和上下文变化均重新校验", async () => {
  const input = await saved();
  await expect(confirmIntakeDraft(actor, { ...input, confirmed: false })).rejects.toThrow(/明确确认/);
  await expect(confirmIntakeDraft({ ...actor, role: "manager" }, { ...input, confirmed: true })).rejects.toThrow(/当前账号/);
  await expect(confirmIntakeDraft({ ...actor, userId: IDS.userManager, role: "manager" }, { ...input, confirmed: true })).rejects.toThrow(/当前核对人/);
  await expect(getCustomerIntake({ ...actor, userId: IDS.userIso, organizationId: IDS.orgIso }, input.sourceId)).rejects.toThrow();
  await prisma.style.update({ where: { id: IDS.styleSt26018 }, data: { name: "主档修改" } });
  await expect(confirmIntakeDraft(actor, { ...input, confirmed: true })).rejects.toThrow(/款式资料已变化/);
  const rechecked = await saveIntakeDraft(actor, { sourceId: input.sourceId, jobId: input.jobId, expectedProposalId: input.proposalId, draft: draft() });
  await prisma.organizationPolicy.create({ data: { id: "new-follow-context", organizationId: actor.organizationId, key: "context:active:follow", note: "new", valueJson: JSON.stringify({ revisionId: "new-revision" }) } });
  await expect(confirmIntakeDraft(actor, { ...rechecked, sourceId: input.sourceId, confirmed: true })).rejects.toThrow(/规则已更新/);
});
it("审计失败回滚跟单与颜色行，不留下半张单；未知款允许明确保留且不造主档", async () => {
  const input = await saved(), before = await prisma.orderMerchSheet.count();
  const original = intakeService.writeAudit;
  vi.spyOn(intakeService, "writeAudit").mockImplementation(async (...args) => { if (args[0].action === "intake.follow_created") throw new Error("audit failure"); return original(...args); });
  await expect(confirmIntakeDraft(actor, { ...input, confirmed: true })).rejects.toThrow("audit failure");
  expect(await prisma.orderMerchSheet.count()).toBe(before); expect(await prisma.actionExecution.count({ where: { proposalId: input.proposalId } })).toBe(0);
  vi.restoreAllMocks(); const unknown = draft(); unknown.items[0].styleId = "";
  const edited = await saveIntakeDraft(actor, { sourceId: input.sourceId, jobId: input.jobId, expectedProposalId: input.proposalId, draft: unknown });
  const result = await confirmIntakeDraft(actor, { ...edited, sourceId: input.sourceId, confirmed: true });
  expect((await prisma.orderMerchStyle.findFirstOrThrow({ where: { sheetId: result.sheetId } })).styleCode).toBe("");
});
function modelCompletion(change?: (value: Record<string, unknown>) => void): Completion {
  let step = 0;
  return async () => {
    step++;
    if (step === 1) return { content: null, tool_calls: [{ id: "lookup", type: "function", function: { name: "read_intake_catalog", arguments: JSON.stringify({ query: "" }) } }] };
    const value: Record<string, unknown> = { customerName: "北岸服饰", factoryName: "云杉服装工厂", seasonCode: "SS27", po: "PO100519", purchaseDate: "2026-09-09", shipDate: "2026-10-31", inboundDate: "", orderKind: "bulk", poNumbers: ["PO100519"], factoryNames: ["云杉服装工厂"], note: "袖口改罗纹", items: [{ styleCode: "ST-26018", productCode: "00186700", styleName: "Sweatshirt", composition: "", note: "规格稍后核对", quote: raw, colors: [{ name: "海军蓝", quantity: "600", quote: "海军蓝600件" }] }], evidence: [{ field: "采购日期", quote: "采购日期2026-09-09" }], warnings: ["罗纹规格待确认"] };
    change?.(value);
    if (step === 2) return { content: null, tool_calls: [{ id: "prepare", type: "function", function: { name: "prepare_customer_po", arguments: JSON.stringify(value) } }] };
    return { content: "请核对表格" };
  };
}
it("模型只查主档并准备可核对表格，原文有依据；新提取使旧确认失效", async () => {
  const input = await saved(); const count = await prisma.orderMerchSheet.count();
  await prepareCustomerIntake(actor, input.sourceId, { useModel: true, completion: modelCompletion() });
  const review = await getCustomerIntake(actor, input.sourceId);
  expect(review.error).toBeNull(); expect(review.draft.customerId).toBe(IDS.customerNorthshore); expect(review.draft.po).toBe("PO100519"); expect(review.proposalId).toBeNull(); expect(review.calledLiveModel).toBe(false);
  expect(await prisma.orderMerchSheet.count()).toBe(count); await expect(confirmIntakeDraft(actor, { ...input, confirmed: true })).rejects.toThrow(/失效/);
  await prepareCustomerIntake(actor, input.sourceId, { useModel: true, completion: modelCompletion(v => { v.po = "PO-INVENTED"; }) });
  expect((await getCustomerIntake(actor, input.sourceId)).error).toMatch(/原文没有/);
});
it("多PO和未配置真实模型均不伪造完成，失败后可人工保存", async () => {
  const sourceId = await source();
  await prepareCustomerIntake(actor, sourceId, { useModel: true });
  expect((await getCustomerIntake(actor, sourceId)).error).toMatch(/尚未启用真实模型/);
  const original = await prisma.sourceDocument.findUniqueOrThrow({ where: { id: sourceId } });
  await prisma.sourceDocument.update({ where: { id: sourceId }, data: { rawText: original.rawText + " 另有 PO100520。" } });
  await prepareCustomerIntake(actor, sourceId, { useModel: true, completion: modelCompletion(v => { v.poNumbers = ["PO100519", "PO100520"]; }) });
  expect((await getCustomerIntake(actor, sourceId)).error).toMatch(/多个PO/);
});
it("相同PO不同原文仍提示原跟单并拒绝重复建单；已知不同客户不混淆", async () => {
  const first = await saved(); const result = await confirmIntakeDraft(actor, { ...first, confirmed: true });
  const nextSource = (await ingestText({ ...actor, text: raw + " 客户再次发送。", origin: "inbox-paste" })).source.id;
  const next = await saveIntakeDraft(actor, { sourceId: nextSource, jobId: null, expectedProposalId: null, draft: draft() });
  expect(next.duplicates).toEqual([{ sheetId: result.sheetId, title: "SS27 客户 PO" }]);
  await expect(confirmIntakeDraft(actor, { ...next, sourceId: nextSource, confirmed: true })).rejects.toThrow(/相同客户PO/);
  const customer = await prisma.customer.create({ data: { id: "other-po-customer", organizationId: actor.organizationId, code: "C-OTHER", name: "其他PO客户", demoNote: "test" } });
  const changed = draft(); changed.customerId = customer.id;
  const revised = await saveIntakeDraft(actor, { sourceId: nextSource, jobId: next.jobId, expectedProposalId: next.proposalId, draft: changed });
  expect(revised.duplicates).toEqual([]);
});
it("日期缺少原文完整年份时保留待补；源原文改变后不能沿用旧确认", async () => {
  const sourceId = (await ingestText({ ...actor, text: raw.replace("出货2026-10-31", "出货10月31日"), origin: "inbox-paste" })).source.id;
  const shortened = raw.replace("出货2026-10-31", "出货10月31日");
  await prepareCustomerIntake(actor, sourceId, { useModel: true, completion: modelCompletion(v => { (v.items as Array<{quote:string}>)[0].quote = shortened; }) });
  const review = await getCustomerIntake(actor, sourceId);
  expect(review.error).toBeNull(); expect(review.draft.shipDate).toBe(""); expect(review.warnings.join()).toContain("完整年份");
  const input = await saveIntakeDraft(actor, { sourceId, jobId: review.jobId, expectedProposalId: null, draft: draft() });
  await prisma.sourceDocument.update({ where: { id: sourceId }, data: { rawText: "different source" } });
  await expect(confirmIntakeDraft(actor, { ...input, sourceId, confirmed: true })).rejects.toThrow(/原始资料已变化/);
});
