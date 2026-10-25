import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { normalizeMerchOrder, readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { ExecutionError } from "./execution";
import { lockOrganizationForWrite } from "./order-write";
import { persistFollowRows } from "./follow-records";

type Actor = { organizationId: string; userId: string; role: string; factoryId?: string | null };
export type HandoverStage = "unstarted" | "cut" | "sewn";
export type TransferSelection = { sizeId: string; quantity: number };
const include = { factory: true, customer: true, lines: { include: { style: true, colors: { include: { sizes: true } }, followStyle: { include: { sheet: true } } } }, production: { include: { lines: true } }, packingPlans: true, purchaseDrafts: true, allocations: true } satisfies Prisma.SalesOrderInclude;
async function actor(db: Prisma.TransactionClient, a: Actor, manager = false) {
  const user = await db.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true } });
  if (!user || user.role !== a.role || !["manager", "salesperson"].includes(user.role) || (manager && user.role !== "manager")) throw new ExecutionError(manager ? "转厂须由主管确认" : "当前账号无权处理转厂");
}
async function snapshot(db: Prisma.TransactionClient, org: string, id: string, allowEnded = false) {
  const order = await db.salesOrder.findFirst({ where: { id, organizationId: org }, include });
  if (!order || !order.factoryId) throw new ExecutionError("请先为订单指定原工厂");
  if (!allowEnded && (["completed", "closed", "cancelled"].includes(order.status) || order.productionReadiness === "shipped")) throw new ExecutionError("已结束或已出运订单不能转厂");
  // Sort before hashing: a different query order must not invalidate an unchanged review.
  const stable = JSON.stringify(order, (_key, value) => Array.isArray(value) && value.every(v => v && typeof v === "object" && "id" in v) ? [...value].sort((a, b) => a.id.localeCompare(b.id)) : value);
  return { order, stamp: sha256(stable) };
}
function availability(order: Awaited<ReturnType<typeof snapshot>>["order"]) {
  const seen = new Set<string>();
  const starts = order.production.filter(p => ["started", "transfer_in", "transfer_out", "good", "scrapped"].includes(p.kind));
  const detailed = starts.every(p => p.lines.reduce((n, l) => n + l.quantity, 0) === p.quantity);
  return order.lines.flatMap(line => line.colors.flatMap(color => {
    const totalAligned = color.sizes.reduce((n, s) => n + s.quantity, 0) === color.quantity;
    return color.sizes.map(size => {
      const key = `${color.colorName}\u0000${size.sizeCode}`;
      const ambiguous = seen.has(key) || order.lines.filter(l => l.colors.some(c => c.colorName === color.colorName && c.sizes.some(s => s.sizeCode === size.sizeCode))).length > 1;
      seen.add(key);
      const qty = (kind: string) => starts.filter(p => p.kind === kind).flatMap(p => p.lines).filter(p => p.colorName === color.colorName && p.sizeCode === size.sizeCode).reduce((n, p) => n + p.quantity, 0);
      const started = qty("started") + qty("transfer_in") - qty("transfer_out");
      const wip = Math.max(0, started - qty("good") - qty("scrapped"));
      const reason = !line.followStyle ? "先补本款跟单关联" : !totalAligned ? "色尺数量未齐" : ambiguous ? "多款共用同色尺，先核对产量归属" : !detailed ? "历史投产未按色尺登记，先核对实数" : "";
      return { sizeId: size.id, lineId: line.id, colorId: color.id, styleCode: line.followStyle?.styleCode || line.style.code, colorName: color.colorName, sizeCode: size.sizeCode, ordered: size.quantity, started, wipAvailable: reason ? 0 : wip, available: reason ? 0 : Math.max(0, size.quantity - started), reason };
    });
  }));
}
function validateSelection(order: Awaited<ReturnType<typeof snapshot>>["order"], selected: TransferSelection[], stage: HandoverStage = "unstarted", processNote = "") {
  const rows = availability(order);
  if (!selected.length || selected.length > 1000 || new Set(selected.map(s => s.sizeId)).size !== selected.length) throw new ExecutionError("请选择不重复的颜色尺码和转厂件数");
  for (const s of selected) {
    const row = rows.find(r => r.sizeId === s.sizeId);
    if (!row || row.reason || !Number.isSafeInteger(s.quantity) || s.quantity <= 0 || s.quantity > (stage === "unstarted" ? row.available : row.wipAvailable)) throw new ExecutionError(`${row?.styleCode ?? "所选款"} ${row?.colorName ?? ""} ${row?.sizeCode ?? ""}：${row?.reason || (stage === "unstarted" ? "转厂数量超过未开工余量" : "转厂数量超过可交接在制余量；合格成品、报废与已转出件数不得重复转出")}`);
  }
  return rows.filter(r => selected.some(s => s.sizeId === r.sizeId)).map(r => ({ ...r, stage, processNote, quantity: selected.find(s => s.sizeId === r.sizeId)!.quantity }));
}
async function audit(db: Prisma.TransactionClient, a: Actor, id: string, action: string, before: unknown, after: unknown, basis: string) {
  await db.auditEvent.create({ data: { id: createId(), organizationId: a.organizationId, actorType: "user", actorUserId: a.userId, entityType: "FactoryTransfer", entityId: id, action: `factory_transfer.${action}`, summary: basis, payloadJson: JSON.stringify({ before, after, basis }) } });
}
export async function getFactoryTransferBoard(a: Actor, orderId: string) {
  await actor(prisma, a);
  const snap = await snapshot(prisma, a.organizationId, orderId, true);
  const factories = await prisma.party.findMany({ where: { organizationId: a.organizationId, kind: "factory", archivedAt: null, id: { not: snap.order.factoryId! } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return { order: { id: snap.order.id, orderNo: snap.order.orderNo, po: snap.order.externalCustomerPo, factoryName: snap.order.factory?.name, updatedAt: snap.order.updatedAt.toISOString() }, stamp: snap.stamp, rows: ["completed", "closed", "cancelled"].includes(snap.order.status) || snap.order.productionReadiness === "shipped" ? [] : availability(snap.order), factories, records: await listFactoryTransfers(a, { orderId }), impact: { purchases: snap.order.purchaseDrafts.length, allocations: snap.order.allocations.length, packing: snap.order.packingPlans.filter(p => p.status !== "shipped").length } };
}
export async function listFactoryTransfers(a: Actor, filter: { orderId?: string; factoryId?: string } = {}) {
  const user = await prisma.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true } });
  if (!user || user.role !== a.role || !["manager", "salesperson", "factory"].includes(user.role)) throw new ExecutionError("无权查看转厂记录");
  const factoryId = a.role === "factory" ? user.factoryId : filter.factoryId;
  if (a.role === "factory" && !factoryId) throw new ExecutionError("未关联工厂");
  const records = await prisma.factoryTransfer.findMany({ where: { organizationId: a.organizationId, AND: [filter.orderId ? { OR: [{ orderId: filter.orderId }, { newOrderId: filter.orderId }] } : {}, factoryId ? { OR: [{ fromFactoryId: factoryId }, { toFactoryId: factoryId, status: "executed" }] } : {}] }, orderBy: { createdAt: "desc" }, take: 100 });
  const parties = await prisma.party.findMany({ where: { organizationId: a.organizationId, id: { in: records.flatMap(r => [r.fromFactoryId, r.toFactoryId]) } }, select: { id: true, name: true } });
  const people = await prisma.user.findMany({ where: { organizationId: a.organizationId, id: { in: records.flatMap(r => [r.requestedBy, r.reviewedBy, r.decidedBy, r.receivedBy].filter((id): id is string => Boolean(id))) } }, select: { id: true, name: true } });
  const orders = await prisma.salesOrder.findMany({ where: { organizationId: a.organizationId, id: { in: records.flatMap(r => [r.orderId, r.newOrderId].filter((id): id is string => Boolean(id))) } }, select: { id: true, orderNo: true } });
  return records.map(r => ({ id: r.id, orderId: r.orderId, orderNo: orders.find(o => o.id === r.orderId)?.orderNo ?? "原订单", newOrderId: r.newOrderId, newOrderNo: orders.find(o => o.id === r.newOrderId)?.orderNo, status: r.status, receivedAt: r.receivedAt?.toISOString() ?? null, receivedBy: people.find(p => p.id === r.receivedBy)?.name ?? "", receiptNote: r.receiptNote, continuationReady: Boolean(JSON.parse(r.afterJson).receipt?.continuationReady), canReceive: r.status === "executed" && !r.receivedAt && (a.role !== "factory" || r.toFactoryId === factoryId), from: parties.find(p => p.id === r.fromFactoryId)?.name ?? "原工厂", to: parties.find(p => p.id === r.toFactoryId)?.name ?? "接收工厂", reason: r.reason, sourceReference: r.sourceReference, reviewNote: a.role === "factory" ? "" : r.reviewNote, decisionNote: a.role === "factory" ? "" : r.decisionNote, requestedBy: people.find(p => p.id === r.requestedBy)?.name ?? "已留档", reviewedBy: people.find(p => p.id === r.reviewedBy)?.name ?? "", decidedBy: people.find(p => p.id === r.decidedBy)?.name ?? "", createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), selections: JSON.parse(r.selectionJson) as Array<{ styleCode: string; colorName: string; sizeCode: string; quantity: number; stage?: HandoverStage; processNote?: string }>, canOpenSource: a.role !== "factory" || r.fromFactoryId === factoryId, canOpenTarget: a.role !== "factory" || r.toFactoryId === factoryId }));
}
export async function requestFactoryTransfer(a: Actor, input: { orderId: string; toFactoryId: string; reason: string; sourceReference: string; stamp: string; selections: TransferSelection[]; idempotencyKey: string; stage?: HandoverStage; processNote?: string }) {
  const stage = input.stage ?? "unstarted";
  const processNote = input.processNote?.trim() ?? "";
  if (!["unstarted", "cut", "sewn"].includes(stage) || (stage !== "unstarted" && !processNote)) throw new ExecutionError("请写明交接工序、已完成内容和新厂接续工序");
  if (!/^[\w-]{8,80}$/.test(input.idempotencyKey) || !input.reason.trim() || !input.sourceReference.trim()) throw new ExecutionError("请填写转厂原因、依据和提交标记");
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, a.organizationId); await actor(db, a);
    const prior = await db.factoryTransfer.findUnique({ where: { organizationId_idempotencyKey: { organizationId: a.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (prior) {
      const old = JSON.parse(prior.selectionJson) as Array<{ sizeId: string; quantity: number; stage?: string; processNote?: string }>;
      const same = (v: TransferSelection[]) => JSON.stringify(v.map(s => [s.sizeId, s.quantity]).sort());
      if (prior.orderId !== input.orderId || prior.toFactoryId !== input.toFactoryId || prior.reason !== input.reason.trim() || prior.sourceReference !== input.sourceReference.trim() || same(old) !== same(input.selections) || (old[0]?.stage ?? "unstarted") !== stage || (old[0]?.processNote ?? "") !== processNote) throw new ExecutionError("提交标记已用于其他转厂内容");
      return { id: prior.id, reused: true };
    }
    const { order, stamp } = await snapshot(db, a.organizationId, input.orderId);
    if (stamp !== input.stamp) throw new ExecutionError("生产或跟单记录已变化，请刷新核对转厂数量");
    const target = await db.party.findFirst({ where: { id: input.toFactoryId, organizationId: a.organizationId, kind: "factory", archivedAt: null } });
    if (!target || target.id === order.factoryId) throw new ExecutionError("请选择本公司的另一家工厂");
    if (await db.factoryTransfer.count({ where: { organizationId: a.organizationId, orderId: order.id, status: { in: ["requested", "reviewed"] } } })) throw new ExecutionError("本单已有待处理转厂，请先处理或退回原申请");
    const selections = validateSelection(order, input.selections, stage, processNote);
    const record = await db.factoryTransfer.create({ data: { id: createId(), organizationId: a.organizationId, orderId: order.id, fromFactoryId: order.factoryId!, toFactoryId: target.id, status: "requested", reason: input.reason.trim(), sourceReference: input.sourceReference.trim(), selectionJson: JSON.stringify(selections), beforeJson: JSON.stringify(order), baseStamp: stamp, requestedBy: a.userId, idempotencyKey: input.idempotencyKey } });
    await audit(db, a, record.id, "requested", null, { status: record.status, selections, fromFactoryId: record.fromFactoryId, toFactoryId: target.id }, record.sourceReference);
    return { id: record.id, reused: false };
  });
}
export async function reviewFactoryTransfer(a: Actor, input: { id: string; action: "review" | "approve" | "reject"; note: string }) {
  if (!input.note.trim()) throw new ExecutionError("请填写核对结果或退回原因");
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, a.organizationId); await actor(db, a, input.action === "approve");
    const record = await db.factoryTransfer.findFirst({ where: { id: input.id, organizationId: a.organizationId } });
    if (!record) throw new ExecutionError("转厂记录不存在");
    if (record.status === "executed" && input.action === "approve") return { id: record.id, orderId: record.newOrderId, reused: true };
    if (["executed", "rejected"].includes(record.status)) throw new ExecutionError("本次转厂已处理，历史记录不能覆盖");
    if (input.action === "reject") {
      await db.factoryTransfer.update({ where: { id: record.id }, data: { status: "rejected", decidedBy: a.userId, decisionNote: input.note.trim() } });
      await audit(db, a, record.id, "rejected", { status: record.status }, { status: "rejected", note: input.note.trim() }, record.sourceReference);
      return { id: record.id, reused: false };
    }
    const { order, stamp } = await snapshot(db, a.organizationId, record.orderId);
    if (stamp !== record.baseStamp) throw new ExecutionError("核对依据已变化，请退回此申请，按最新生产与料况重新登记转厂");
    const saved = JSON.parse(record.selectionJson) as Array<TransferSelection & { stage?: HandoverStage; processNote?: string }>;
    const stage = saved[0]?.stage ?? "unstarted";
    const selections = validateSelection(order, saved, stage, saved[0]?.processNote ?? "");
    if (input.action === "review") {
      if (record.status !== "requested") throw new ExecutionError("影响已核对，内容变化需退回重做");
      await db.factoryTransfer.update({ where: { id: record.id }, data: { status: "reviewed", reviewedBy: a.userId, reviewNote: input.note.trim() } });
      await audit(db, a, record.id, "reviewed", { status: "requested" }, { status: "reviewed", note: input.note.trim() }, "负责人核对颜色数量、材料去向、原厂费用及交期影响");
      return { id: record.id, reused: false };
    }
    if (record.status !== "reviewed") throw new ExecutionError("负责人尚未核对转厂影响，主管不能直接跳过确认");
    const target = await db.party.findFirst({ where: { id: record.toFactoryId, organizationId: a.organizationId, kind: "factory", archivedAt: null } });
    if (!target) throw new ExecutionError("接收工厂主档已变化，请重新核对");
    const source = await db.sourceDocument.create({ data: { id: createId(), organizationId: a.organizationId, contentHash: sha256(`factory-transfer:${record.id}`), origin: "factory-transfer", mimeType: "application/json", rawText: JSON.stringify({ transferId: record.id, originalOrderId: order.id, externalCustomerPo: order.externalCustomerPo, selections, reason: record.reason, reference: record.sourceReference, reviewNote: record.reviewNote, decisionNote: input.note.trim() }), receivedAt: new Date(), parseStatus: "succeeded" } });
    const id = createId(), orderNo = `TF-${record.id.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const moved = await db.salesOrder.create({ data: { id, organizationId: a.organizationId, orderNo, customerId: order.customerId, factoryId: target.id, externalCustomerPo: order.externalCustomerPo, status: "draft", productionReadiness: "blocked_factory_transfer", requestedDeliveryText: order.requestedDeliveryText, requestedDeliveryDate: order.requestedDeliveryDate, sourceDocumentId: source.id, createdByUserId: a.userId, notes: `从 ${order.orderNo} 转入${stage === "unstarted" ? "未开工余量" : stage === "cut" ? "已裁裁片" : "车缝半成品"}。原厂生产、采购和收付保留；重新核对料况、分色并批准投产。` } });
    const follow = await db.orderMerchSheet.create({ data: { id: createId(), organizationId: a.organizationId, salesOrderId: id, customerId: order.customerId, factoryId: target.id, factoryName: target.name, title: `${order.externalCustomerPo || order.orderNo} · 转入 ${target.name}`, kind: "bulk", seasonCode: order.lines.find(l => l.followStyle)?.followStyle?.sheet.seasonCode ?? "", craftFamily: "", salesSampleJson: "{}", bulkJson: "{}" } });
    for (const line of order.lines) {
      const selected = selections.filter(s => s.lineId === line.id); if (!selected.length) continue;
      const qty = selected.reduce((n, s) => n + s.quantity, 0);
      const newLine = await db.orderLine.create({ data: { id: createId(), orderId: id, styleId: line.styleId, styleVersionId: line.styleVersionId, totalQuantity: qty, notes: `转厂记录 ${record.id}` } });
      for (const color of line.colors) {
        const sizes = selected.filter(s => s.colorId === color.id); if (!sizes.length) continue;
        const sum = sizes.reduce((n, s) => n + s.quantity, 0);
        await db.orderColorQty.create({ data: { id: createId(), lineId: newLine.id, colorName: color.colorName, quantity: sum, sizes: { create: sizes.map(s => ({ id: createId(), sizeCode: s.sizeCode, quantity: s.quantity })) } } });
        await db.orderColorQty.update({ where: { id: color.id }, data: { quantity: { decrement: sum } } });
        for (const size of sizes) await db.orderSizeQty.update({ where: { id: size.sizeId }, data: { quantity: { decrement: size.quantity } } });
      }
      await db.orderLine.update({ where: { id: line.id }, data: { totalQuantity: { decrement: qty } } });
      const original = line.followStyle!;
      const sheet = await db.orderMerchSheet.findUniqueOrThrow({ where: { id: original.sheetId }, include: { styles: { orderBy: { sort: "asc" } } } });
      const styles = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
      const style = styles.find(s => s.rowId === original.id)!;
      const totals = new Map<string, number>(); for (const row of selected) totals.set(row.colorName, (totals.get(row.colorName) ?? 0) + row.quantity);
      if (sheet.kind !== "bulk" || style.bulk.colors.some(c => totals.has(c.guestColor) && !/^\d+$/.test(c.qtyText))) throw new ExecutionError("跟单与生产单颜色数量尚未核对，不能更新总表");
      for (const [name, count] of totals) {
        const matches = style.bulk.colors.filter(c => c.guestColor === name);
        if (matches.length !== 1 || Number(matches[0].qtyText) !== line.colors.filter(c => c.colorName === name).reduce((n, c) => n + c.quantity, 0) || count > Number(matches[0].qtyText)) throw new ExecutionError("跟单与生产单颜色数量不一致，请先核对");
      }
      const copy = structuredClone(style); delete copy.rowId;
      copy.bulk.colors = copy.bulk.colors.filter(c => totals.has(c.guestColor)).map(c => ({ ...c, qtyText: String(totals.get(c.guestColor)) }));
      for (const color of style.bulk.colors) if (totals.has(color.guestColor)) color.qtyText = String(Number(color.qtyText) - totals.get(color.guestColor)!);
      await persistFollowRows(db, sheet.id, styles);
      await db.orderMerchSheet.update({ where: { id: sheet.id }, data: { updatedAt: new Date() } });
      const normalized = normalizeMerchOrder({ styles: [copy] }).styles[0];
      await db.orderMerchStyle.create({ data: { id: createId(), sheetId: follow.id, sort: order.lines.indexOf(line), styleCode: normalized.styleCode, styleName: normalized.styleName, craftFamily: normalized.craftFamily, imagePath: normalized.imagePath, labDipJson: JSON.stringify(normalized.labDip), salesSampleJson: JSON.stringify(normalized.salesSample), bulkJson: JSON.stringify(normalized.bulk), productionLineId: newLine.id } });
    }
    if (stage !== "unstarted") {
      await db.productionQty.create({ data: { id: createId(), orderId: order.id, kind: "transfer_out", quantity: selections.reduce((n, r) => n + r.quantity, 0), idempotencyKey: `transfer-out:${record.id}`, note: `在制转厂交接 ${record.id}；${selections[0].processNote}；主管确认转出，新厂接收另记`, lines: { create: selections.map(r => ({ id: createId(), colorName: r.colorName, sizeCode: r.sizeCode, quantity: r.quantity })) } } });
    }
    // Purchases, allocations, receipts and financial vouchers remain on the original order.
    await db.salesOrder.update({ where: { id: order.id }, data: { updatedAt: new Date() } });
    for (const task of [{ orderId: order.id, title: "转厂后核对原厂余料、采购和费用", blocking: false }, { orderId: id, title: "接收转厂任务，核对分色、料况并重新批准投产", blocking: true }]) await db.taskItem.create({ data: { id: createId(), organizationId: a.organizationId, title: task.title, kind: "factory_transfer_handover", status: "open", blocking: task.blocking, assigneeRole: "salesperson", relatedOrderId: task.orderId, sourceDocumentId: source.id, note: `转厂 ${record.id}；${record.reviewNote}；原采购、库存与财务凭证未转写，请按实际交接登记。` } });
    await db.actionProposal.updateMany({ where: { organizationId: a.organizationId, status: "preview", payloadJson: { contains: order.id } }, data: { status: "expired" } });
    const after = { originalOrderId: order.id, newOrderId: id, newOrderNo: orderNo, followSheetId: follow.id, fromFactoryId: record.fromFactoryId, toFactoryId: target.id, selections, customerPoUnchanged: order.externalCustomerPo };
    await db.factoryTransfer.update({ where: { id: record.id }, data: { status: "executed", decidedBy: a.userId, decisionNote: input.note.trim(), newOrderId: id, afterJson: JSON.stringify(after) } });
    await audit(db, a, record.id, "executed", JSON.parse(record.beforeJson), after, `主管确认：${input.note.trim()}；${record.sourceReference}`);
    return { id: record.id, orderId: moved.id, followSheetId: follow.id, reused: false };
  }, { timeout: 30000 });
}

export async function acknowledgeFactoryTransfer(a: Actor, input: { id: string; note: string; receivedQuantity?: number; continuationNote?: string; continuationReady?: boolean }) {
  if (!input.note.trim()) throw new ExecutionError("请填写新厂接收凭据或交接确认说明");
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, a.organizationId);
    const user = await db.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true } });
    const r = await db.factoryTransfer.findFirst({ where: { id: input.id, organizationId: a.organizationId } });
    if (!user || user.role !== a.role || !r || !["manager", "salesperson", "factory"].includes(user.role) || (user.role === "factory" && user.factoryId !== r.toFactoryId)) throw new ExecutionError("无权确认接收此转厂任务");
    if (r.status !== "executed" || !r.newOrderId) throw new ExecutionError("转厂尚未由主管确认");
    if (r.receivedAt) return { id: r.id, reused: true };
    const selections = JSON.parse(r.selectionJson) as Array<{ colorName: string; sizeCode: string; quantity: number; stage?: HandoverStage }>;
    const stage = selections[0]?.stage ?? "unstarted";
    const total = selections.reduce((n, row) => n + row.quantity, 0);
    if (stage !== "unstarted") {
      if (input.receivedQuantity !== total || !input.continuationNote?.trim()) throw new ExecutionError(`请逐色尺核对实物共 ${total} 件，并填写接续工序、质量及后续用料核对结果；数量不符不得确认全数接收`);
      await db.productionQty.create({ data: { id: createId(), orderId: r.newOrderId, kind: "transfer_in", quantity: total, idempotencyKey: `transfer-in:${r.id}`, note: `接收${stage === "cut" ? "裁片" : "车缝半成品"}；${input.continuationNote.trim()}；这是接续，不是重新投产`, lines: { create: selections.map(row => ({ id: createId(), colorName: row.colorName, sizeCode: row.sizeCode, quantity: row.quantity })) } } });
    }
    const receivedAt = new Date();
    await db.factoryTransfer.update({ where: { id: r.id }, data: { receivedAt, receivedBy: a.userId, receiptNote: input.note.trim(), afterJson: JSON.stringify({ ...JSON.parse(r.afterJson), receipt: { receivedQuantity: stage === "unstarted" ? null : total, continuationNote: input.continuationNote?.trim() ?? "", continuationReady: input.continuationReady === true, receivedAt: receivedAt.toISOString(), receivedBy: a.userId } }) } });
    if (stage === "unstarted" || input.continuationReady === true) await db.taskItem.updateMany({ where: { organizationId: a.organizationId, relatedOrderId: r.newOrderId, kind: "factory_transfer_handover", status: "open", blocking: true }, data: { status: "done" } });
    await db.salesOrder.update({ where: { id: r.newOrderId }, data: { updatedAt: receivedAt } });
    await audit(db, a, r.id, "received", { receivedAt: null }, { receivedAt: receivedAt.toISOString(), receivedBy: a.userId, note: input.note.trim(), receivedQuantity: input.receivedQuantity ?? null, continuationNote: input.continuationNote ?? "", continuationReady: input.continuationReady === true, stage, method: user.role === "factory" ? "接收工厂本人确认" : "负责人依据凭证登记新厂接收" }, "未开工任务接收不等于收料；半成品接收记录实物与工序，不重复计投产，不自动放行");
    return { id: r.id, reused: false };
  });
}

export async function confirmTransferContinuation(a: Actor, input: { id: string; note: string; expectedUpdatedAt: string; continuationReady: boolean }) {
  if (!input.continuationReady || !input.note.trim()) throw new ExecutionError("请核对后续用料齐备并填写工序、质量及用料凭据");
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, a.organizationId);
    const user = await db.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true, role: a.role } });
    const r = await db.factoryTransfer.findFirst({ where: { id: input.id, organizationId: a.organizationId } });
    if (!user || !r || !["manager", "salesperson", "factory"].includes(user.role) || (user.role === "factory" && user.factoryId !== r.toFactoryId)) throw new ExecutionError("无权核对本次接续");
    if (!r.newOrderId || !r.receivedAt || (JSON.parse(r.selectionJson)[0]?.stage ?? "unstarted") === "unstarted") throw new ExecutionError("请先核对接收在制实物");
    if (r.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new ExecutionError("交接记录已变化，请刷新核对");
    const before = JSON.parse(r.afterJson), after = { ...before, receipt: { ...before.receipt, continuationReady: true, continuationNote: input.note.trim(), checkedBy: a.userId, checkedAt: new Date().toISOString() } };
    await db.factoryTransfer.update({ where: { id: r.id }, data: { afterJson: JSON.stringify(after) } });
    await db.taskItem.updateMany({ where: { organizationId: a.organizationId, relatedOrderId: r.newOrderId, kind: "factory_transfer_handover", status: "open", blocking: true }, data: { status: "done" } });
    await db.salesOrder.update({ where: { id: r.newOrderId }, data: { updatedAt: new Date() } });
    await audit(db, a, r.id, "continuation_checked", before.receipt, after.receipt, "实物、工序与后续用料核对，投产仍须主管手动放行");
    return { id: r.id };
  });
}
