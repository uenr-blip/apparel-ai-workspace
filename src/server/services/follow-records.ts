import { resolveStyleCodes } from "./style-code";
import type { OrderMerchStyle, Prisma } from "@prisma/client";
import { createId } from "@/lib/hash";
import { orderColorPieces, readStoredMerchStyles, type MerchStyle } from "@/server/domain/merch-sheet";
import { followBatchFingerprint } from "@/server/domain/follow-po";
import { ExecutionError } from "./execution";

export function bindFollowRows(styles: MerchStyle[], existing: OrderMerchStyle[]) {
  const used = new Set<string>();
  return styles.map((s, i) => {
    const old = s.rowId ? existing.find(r => r.id === s.rowId) : existing[i];
    if (s.rowId && !old) throw new ExecutionError("款行已变化或不属于此跟单，请刷新核对");
    const id = old?.id ?? createId();
    if (used.has(id)) throw new ExecutionError("同一款行不能重复提交");
    used.add(id);
    return { ...s, rowId: id };
  });
}

export async function persistFollowRows(db: Prisma.TransactionClient, sheetId: string, styles: MerchStyle[]) {
  const existing = await db.orderMerchStyle.findMany({ where: { sheetId }, orderBy: { sort: "asc" } });
  const rows = bindFollowRows(styles, existing);
  const removed = existing.filter(r => !rows.some(s => s.rowId === r.id));
  const expenses = await db.tradeBill.findMany({ where: { followRowId: { in: existing.map(r => r.id) } }, select: { followRowId: true, organizationId: true } });
  for (const expense of expenses) {
    const before = existing.find(r => r.id === expense.followRowId)!, after = rows.find(r => r.rowId === expense.followRowId);
    if (!after) throw new ExecutionError("本款已有费用凭据，不能删除；可归档跟单并保留财务依据");
    if (before.styleCode !== after.styleCode) {
      const resolved = await resolveStyleCodes(db, expense.organizationId, [before.styleCode, after.styleCode]);
      if (!resolved.get(before.styleCode) || resolved.get(before.styleCode)?.id !== resolved.get(after.styleCode)?.id) throw new ExecutionError("本款已有费用归属，不能换成其他款，请另建款行");
    }
  }
  const stages = await db.workflowStage.findMany({ where: { followRowId: { in: existing.map(r => r.id) } } });
  for (const stage of stages) {
    const before = existing.find(r => r.id === stage.followRowId)!, after = rows.find(r => r.rowId === stage.followRowId);
    if (!after) throw new ExecutionError("本款已有阶段资料和交接历史，不能删除；可归档整张跟单");
    if (before.styleCode !== after.styleCode) {
      const resolved = await resolveStyleCodes(db, stage.organizationId, [after.styleCode]);
      if (!stage.styleId || resolved.get(after.styleCode)?.id !== stage.styleId) throw new ExecutionError("已有交接记录的款不能换成另一款，请另建款行");
    }
  }
  if (removed.some(r => r.productionLineId)) throw new ExecutionError("已经转生产的款不能删除，请走客户改单");
  await db.orderMerchStyle.deleteMany({ where: { id: { in: removed.map(r => r.id) } } });
  for (const [sort, s] of rows.entries()) {
    const data = { sort, styleCode: s.styleCode, styleName: s.styleName, craftFamily: s.craftFamily, imagePath: s.imagePath, labDipJson: JSON.stringify(s.labDip), salesSampleJson: JSON.stringify(s.salesSample), bulkJson: JSON.stringify(s.bulk) };
    await db.orderMerchStyle.upsert({ where: { id: s.rowId }, create: { id: s.rowId, sheetId, ...data }, update: data });
  }
}

export async function hydrateLegacyFollowLinks(db: Prisma.TransactionClient, sheet: { id: string; organizationId: string; kind: string; salesOrderId: string | null }, userId: string) {
  if (!sheet.salesOrderId) return;
  const rows = await db.orderMerchStyle.findMany({ where: { sheetId: sheet.id }, orderBy: { sort: "asc" } });
  const lines = await db.orderLine.findMany({ where: { orderId: sheet.salesOrderId }, include: { style: true, colors: true, followStyle: true } });
  const masterCodes = await resolveStyleCodes(db, sheet.organizationId, rows.map(r => r.styleCode));
  const changes: Array<{ rowId: string; lineId: string }> = [];
  const pieces = (v: Array<{ colorName: string; quantity: number }>) => JSON.stringify(v.map(r => `${r.colorName}:${r.quantity}`).sort());
  for (const row of rows.filter(r => !r.productionLineId)) {
    const style = readStoredMerchStyles({ craftFamily: "", salesSampleJson: "{}", bulkJson: "{}", styles: [row] }, { styleCode: "", styleName: "" })[0];
    const candidates = lines.filter(l => !l.followStyle && !changes.some(c => c.lineId === l.id) && l.styleId === masterCodes.get(row.styleCode)?.id && pieces(l.colors) === pieces(orderColorPieces(style, sheet.kind)));
    if (candidates.length === 1) {
      await db.orderMerchStyle.update({ where: { id: row.id }, data: { productionLineId: candidates[0].id } });
      changes.push({ rowId: row.id, lineId: candidates[0].id });
    } else if (lines.some(l => l.styleId === masterCodes.get(row.styleCode)?.id && !l.followStyle && !changes.some(c => c.lineId === l.id))) throw new ExecutionError("旧跟单与生产单的款行存在歧义，请核对原生产单，不能重复转出");
  }
  if (changes.length) await db.auditEvent.create({ data: { id: createId(), organizationId: sheet.organizationId, actorType: "user", actorUserId: userId, entityType: "OrderMerchSheet", entityId: sheet.id, action: "follow.legacy_links_verified", summary: "本次操作核验旧单逐款关系，未新建生产单", payloadJson: JSON.stringify({ before: null, after: changes, basis: "同一原生产单、唯一款式及完全一致颜色数量" }) } });
}

export function assertTransferredRowsUnchanged(before: MerchStyle[], after: MerchStyle[], rows: OrderMerchStyle[], kind: string) {
  const bound = bindFollowRows(after, rows);
  for (const row of rows.filter(r => r.productionLineId)) {
    const old = before.find(s => s.rowId === row.id), next = bound.find(s => s.rowId === row.id);
    if (!old || !next || followBatchFingerprint([old], kind) !== followBatchFingerprint([next], kind)) throw new ExecutionError("本款已开生产订单，批次内容不能直接覆盖，请打开客户改单；未转出的款仍可补齐后续开");
  }
}

export async function resolveFollowPartners(db: Prisma.TransactionClient, org: string, input: { factoryId?: string | null; factoryName?: string; customerId?: string | null }, requireFactory = false) {
  const factories = input.factoryId ? await db.party.findMany({ where: { id: input.factoryId, organizationId: org, kind: "factory", archivedAt: null } }) : input.factoryName ? await db.party.findMany({ where: { organizationId: org, kind: "factory", archivedAt: null, name: input.factoryName.trim() } }) : [];
  if (input.factoryId && factories.length !== 1) throw new ExecutionError("请选择本公司的工厂主档");
  if (requireFactory && factories.length !== 1) throw new ExecutionError("请从资源中心的工厂主档选择；未建档的工厂先建档，不按自由文本猜测");
  const customer = input.customerId ? await db.customer.findFirst({ where: { id: input.customerId, organizationId: org, archivedAt: null } }) : null;
  if (input.customerId && !customer) throw new ExecutionError("请选择本公司的客户主档");
  return { factoryId: factories[0]?.id ?? null, factoryName: factories[0]?.name ?? input.factoryName?.trim() ?? "", customerId: customer?.id ?? null };
}

export async function validateCustomerProducts(db: Prisma.TransactionClient, org: string, customerId: string | null, sheetId: string | null, styles: MerchStyle[]) {
  if (!customerId) return;
  const history = await db.orderMerchSheet.findMany({ where: { organizationId: org, ...(sheetId ? { id: { not: sheetId } } : {}), OR: [{ customerId }, { order: { customerId } }] }, include: { styles: true } });
  const prior = history.flatMap(s => readStoredMerchStyles(s, { styleCode: "", styleName: "" }));
  const resolved = await resolveStyleCodes(db, org, [...new Set([...prior, ...styles].map(s => s.styleCode).filter(Boolean))]);
  const identity = (s: MerchStyle) => resolved.get(s.styleCode)?.id ?? s.styleCode.toUpperCase();
  for (const s of styles) {
    if (!s.styleCode || !s.salesSample.numericCode) continue;
    if (prior.some(p => p.styleCode && p.salesSample.numericCode && ((identity(p) === identity(s)) !== (p.salesSample.numericCode === s.salesSample.numericCode)))) throw new ExecutionError(`${s.styleCode} 的产品编号与该客户历史批次不一致，请核对固定产品编号`);
  }
}
