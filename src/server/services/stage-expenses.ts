import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { checkDate, parseMoney, TradeError } from "@/lib/trade-money";
import { PLATFORM_CONTEXT_VERSION } from "@/server/context/platform";
import { billCte, requireTrade, tradeParty, type BillRow, type TradeDb } from "./trade-db";
import { billView, tradeToday } from "./trade-read";
import { EXPENSE_KINDS, type TradeActor, type TradeCommand } from "./trade-contract";

export type ExpenseTarget = { projectId?: string; followRowId?: string };
/** Business attribution is fixed at occurrence; a later handoff does not move or duplicate the bill. */
export async function expenseSubject(actor: TradeActor, target: ExpenseTarget, db: TradeDb = prisma) {
  await requireTrade(actor, "trade_view", db);
  if (Number(Boolean(target.projectId)) + Number(Boolean(target.followRowId)) !== 1) throw new TradeError("请选择唯一的开发或跟单款式");
  const org = actor.organizationId;
  const project = target.projectId ? await db.developmentProject.findFirst({ where: { id: target.projectId, organizationId: org }, include: { style: true } }) : null;
  const row = target.followRowId ? await db.orderMerchStyle.findFirst({ where: { id: target.followRowId, sheet: { organizationId: org } }, include: { sheet: true, productionLine: true } }) : null;
  if (!project && !row) throw new TradeError("费用所属资料不存在或无权查阅", 404);
  if (row && !["sales_sample", "bulk"].includes(row.sheet.kind)) throw new TradeError("请选择销售样或大货跟单款式");
  const kind = project ? "development" : row!.sheet.kind;
  const label = project ? `开发 · ${project.code} ${project.name}` : `${kind === "sales_sample" ? "销售样" : "大货"} · ${row!.styleCode} ${row!.styleName} · ${row!.sheet.title}`;
  const href = project ? `/projects/${project.id}#stage-expenses` : `/orders/follow/${row!.sheetId}?rowId=${encodeURIComponent(row!.id)}#stage-expenses`;
  const archived = Boolean(project?.archivedAt || project?.style?.archivedAt || row?.sheet.archivedAt);
  const legacyOrder = row?.sheet.salesOrderId && !row.productionLineId && !await db.orderMerchStyle.count({ where: { sheetId: row.sheetId, productionLineId: { not: null } } }) ? row.sheet.salesOrderId : null;
  const orderId = row?.productionLine?.orderId ?? legacyOrder ?? null;
  const snapshot = { kind, label, href, projectId: project?.id ?? null, followRowId: row?.id ?? null, customerId: project?.customerId ?? row?.sheet.customerId ?? null, orderId };
  const stamp = sha256(JSON.stringify({ snapshot, project, row, platform: PLATFORM_CONTEXT_VERSION }));
  return { ...snapshot, stamp, archived, canCreate: !archived && !orderId };
}

export async function writeStageExpense(db: TradeDb, actor: TradeActor, command: Extract<TradeCommand, { action: "create_stage_expense" }>, now: string) {
  const subject = await expenseSubject(actor, command, db);
  if (subject.stamp !== command.expectedStamp) throw new TradeError("所属资料或规则已变化，请重新打开费用登记核对", 409);
  if (!subject.canCreate) throw new TradeError(subject.orderId ? "该款已开生产单，请从本单应付登记新费用；此前阶段费用保留" : "资料已归档，不能新增费用");
  const party = await tradeParty(db, actor.organizationId, "party", command.partyId);
  if (party.archivedAt) throw new TradeError("往来方已归档，请先核对有效供应商或工厂");
  const expenseDate = checkDate(command.expenseDate), dueDate = checkDate(command.dueDate), amount = parseMoney(command.amount, command.currency);
  const duplicate = await db.tradeBill.findFirst({ where: { organizationId: actor.organizationId, partyKind: "party", partyId: party.id, expenseReference: command.expenseReference, status: { not: "void" } } });
  if (duplicate) throw new TradeError("该往来方已有相同费用凭据号，请核对原记录；同一凭据分项请填写不同的分项编号", 409);
  const category = command.expenseKind === "materials" ? "materials" : ["sampling", "processing"].includes(command.expenseKind) ? "processing" : "other";
  const id = createId();
  await db.tradeBill.create({ data: { id, organizationId: actor.organizationId, orderId: null, projectId: subject.projectId, followRowId: subject.followRowId,
    subjectJson: JSON.stringify({ kind: subject.kind, label: subject.label, href: subject.href, customerId: subject.customerId, expenseKind: command.expenseKind, platform: PLATFORM_CONTEXT_VERSION }),
    expenseDate, expenseReference: command.expenseReference, direction: "payable", partyKind: "party", partyId: party.id, title: command.title, category, currency: command.currency, amountMinor: amount, dueDate, basis: command.basis,
    sourceKind: "manual", status: "draft", version: 1, createdBy: actor.userId, createdAt: now } });
  return { id, summary: `${subject.label} 登记${EXPENSE_KINDS[command.expenseKind]}草稿：${command.currency} ${command.amount}；待财务核对，未计入应付余额` };
}

/** Only explicit incoming handoffs establish ancestry; same style alone is not evidence. */
export async function getStageExpenses(actor: TradeActor, target: ExpenseTarget) {
  const subject = await expenseSubject(actor, target), org = actor.organizationId;
  const stage = await prisma.workflowStage.findFirst({ where: { organizationId: org, ...(subject.projectId ? { projectId: subject.projectId } : { followRowId: subject.followRowId }) } });
  const ancestors: Array<{ projectId: string | null; followRowId: string | null }> = [];
  const visited = new Set<string>(stage ? [stage.id] : []); let frontier = stage ? [stage.id] : [];
  while (frontier.length) {
    const links = await prisma.workflowTransfer.findMany({ where: { organizationId: org, targetStageId: { in: frontier } } });
    const ids = [...new Set(links.map(l => l.sourceStageId).filter(id => !visited.has(id)))];
    if (visited.size + ids.length > 100) throw new TradeError("交接来源较多，请到财务按具体阶段查阅；未返回截断金额");
    ids.forEach(id => visited.add(id));
    const rows = await prisma.workflowStage.findMany({ where: { id: { in: ids }, organizationId: org } });
    ancestors.push(...rows); frontier = rows.map(r => r.id);
  }
  const own = subject.projectId ? Prisma.sql`projectId=${subject.projectId}` : Prisma.sql`followRowId=${subject.followRowId}`;
  const prior = ancestors.map(a => a.projectId ? Prisma.sql`projectId=${a.projectId}` : Prisma.sql`followRowId=${a.followRowId}`);
  const where = Prisma.sql`(${own}${prior.length ? Prisma.sql` OR ${Prisma.join(prior, " OR ")}` : Prisma.empty})`;
  const rows = await prisma.$queryRaw<BillRow[]>(Prisma.sql`${billCte(org)} SELECT * FROM bills WHERE ${where} ORDER BY createdAt DESC,id LIMIT 501`);
  if (rows.length > 500) throw new TradeError("关联费用超过 500 笔，请到财务按阶段筛选；未返回截断金额");
  const today = await tradeToday(actor);
  return { subject, rows: rows.map(row => ({ ...billView(row, today), inherited: subject.projectId ? row.projectId !== subject.projectId : row.followRowId !== subject.followRowId })) };
}
