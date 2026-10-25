import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { computeReconDraft } from "@/server/domain/recon";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { lockOrderForWrite } from "@/server/services/order-write";
import { canUserAction } from "@/server/services/user-permissions";
import { resourcePage } from "@/server/services/resource-scope";
import { financeCte, financeWhere, type FinanceFilter, type FinanceState } from "./finance-query";

export const FACTORY_RECON_BASIS_KEY = "factory_recon_basis";
export type ReconActor = { organizationId: string; userId: string; role: string; factoryId: string | null };
export type FactoryReconView = {
  id: string; orderId: string; status: "draft" | "needs_basis"; shippedQty: number;
  unitPriceYuan: string | null; amountYuan: string | null; basisNote: string; paid: boolean;
};
const orderInclude = { reconDrafts: true, factory: true, customer: true } as const;
type ReconOrder = Prisma.SalesOrderGetPayload<{ include: typeof orderInclude }>;
type Policy = { enabled: boolean; valueJson: string; note: string } | null;
type ReconDb = Pick<Prisma.TransactionClient, "salesOrder" | "productionQty" | "organizationPolicy">;

function viewOf(draft: { id: string; orderId: string; status: string; shippedQty: number; unitPriceYuan: string | null; amountYuan: string | null; basisNote: string; paid: boolean }): FactoryReconView {
  return { id: draft.id, orderId: draft.orderId, status: draft.status as FactoryReconView["status"], shippedQty: draft.shippedQty, unitPriceYuan: draft.unitPriceYuan, amountYuan: draft.amountYuan, basisNote: draft.basisNote, paid: draft.paid };
}
function parseBasis(policy: Policy) {
  if (!policy?.enabled) return { unitPriceYuan: null, basisNote: "未配置工厂对账计价基准，待核实。不是付款。" };
  try {
    const value = JSON.parse(policy.valueJson) as { unitPriceYuan?: string; qtyKind?: string };
    if (value.qtyKind !== "shipped_good") throw new Error("unsupported basis");
    return { unitPriceYuan: value.unitPriceYuan?.trim() || null, basisNote: policy.note || "合格出运件数 × 确认单价；不是付款。" };
  } catch { return { unitPriceYuan: null, basisNote: "计价基准无效，待核实" }; }
}
function previewFor(order: ReconOrder, totals: { shipped: number; good: number }, policy: Policy) {
  const draft = order.reconDrafts[0];
  const configured = parseBasis(policy);
  const basis = draft ? { unitPriceYuan: draft.unitPriceYuan, basisNote: draft.basisNote } : configured;
  const computed = computeReconDraft({ shippedQty: totals.shipped, ...basis });
  const blockedReason = draft?.paid ? "该记录已有付款标记，当前入口不能改写" : !order.factoryId ? "尚未指定加工工厂" : totals.shipped <= 0 ? "还没有出运数量" : totals.shipped > totals.good ? "出运超过合格数量，请先核对生产记录" : null;
  return {
    orderId: order.id, orderNo: order.orderNo, factoryId: order.factoryId, factoryName: order.factory?.name ?? "未指定工厂", customerName: order.customer.name,
    snapshot: sha256(JSON.stringify({ orderId: order.id, factoryId: order.factoryId, totals: { good: totals.good, shipped: totals.shipped }, policy: policy ? { enabled: policy.enabled, valueJson: policy.valueJson, note: policy.note } : null, draft: draft ? { id: draft.id, updatedAt: draft.updatedAt, shippedQty: draft.shippedQty, unitPriceYuan: draft.unitPriceYuan, amountYuan: draft.amountYuan, basisNote: draft.basisNote } : null })),
    currentShippedQty: totals.shipped, goodQty: totals.good, ...computed, blockedReason,
    draft: draft ? viewOf(draft) : null,
    needsUpdate: !!draft && (draft.shippedQty !== totals.shipped || draft.factoryId !== order.factoryId || draft.amountYuan !== computed.amountYuan),
    configuredUnitPrice: configured.unitPriceYuan,
  };
}
export async function getFactoryReconPreview(organizationId: string, orderId: string, client: ReconDb = prisma) {
  const order = await client.salesOrder.findFirst({ where: { id: orderId, organizationId }, include: orderInclude });
  if (!order) throw new ExecutionError("订单不存在");
  const rows = await client.productionQty.groupBy({ by: ["kind"], where: { orderId, kind: { in: ["good", "shipped"] } }, _sum: { quantity: true } });
  const totals = { good: rows.find(row => row.kind === "good")?._sum.quantity ?? 0, shipped: rows.find(row => row.kind === "shipped")?._sum.quantity ?? 0 };
  const policy = await client.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId, key: FACTORY_RECON_BASIS_KEY } } });
  return previewFor(order, totals, policy);
}

/** Same snapshot semantics as the single-order preview, with bounded batch reads. */
export async function getFactoryReconPreviews(organizationId: string, orderIds: string[], client: ReconDb = prisma) {
  const [orders, totals, policy] = await Promise.all([
    client.salesOrder.findMany({ where: { organizationId, id: { in: orderIds } }, include: orderInclude }),
    client.productionQty.groupBy({ by: ["orderId", "kind"], where: { order: { organizationId }, orderId: { in: orderIds }, kind: { in: ["good", "shipped"] } }, _sum: { quantity: true } }),
    client.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId, key: FACTORY_RECON_BASIS_KEY } } }),
  ]);
  const values = new Map<string, { good: number; shipped: number }>();
  for (const row of totals) {
    const value = values.get(row.orderId) ?? { good: 0, shipped: 0 };
    if (row.kind === "good") value.good = row._sum.quantity ?? 0;
    if (row.kind === "shipped") value.shipped = row._sum.quantity ?? 0;
    values.set(row.orderId, value);
  }
  return new Map(orders.map(order => [order.id, previewFor(order, values.get(order.id) ?? { good: 0, shipped: 0 }, policy)]));
}
export type FactoryReconPreview = Awaited<ReturnType<typeof getFactoryReconPreview>>;

export async function listFinanceReconciliations(actor: ReconActor, filter: FinanceFilter = {}) {
  if (!await canUserAction(actor, "generate_factory_recon")) throw new ExecutionError("无权查阅工厂对账，请由经理授权");
  const page = resourcePage(filter.page);
  const cte = financeCte(actor.organizationId), where = financeWhere(filter);
  const [counts, selected, policy] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) count FROM finance WHERE ${where}`),
    prisma.$queryRaw<Array<{ id: string; state: FinanceState }>>(Prisma.sql`${cte} SELECT id, state FROM finance WHERE ${where} ORDER BY updatedAt DESC, id ASC LIMIT 20 OFFSET ${(page - 1) * 20}`),
    prisma.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId: actor.organizationId, key: FACTORY_RECON_BASIS_KEY } } }),
  ]);
  const total = Number(counts[0].count);
  const fetched = await prisma.salesOrder.findMany({ where: { organizationId: actor.organizationId, id: { in: selected.map(row => row.id) } }, include: orderInclude });
  const byId = new Map(fetched.map(row => [row.id, row]));
  const orders = selected.flatMap(row => byId.has(row.id) ? [byId.get(row.id)!] : []);
  const totals = await prisma.productionQty.groupBy({ by: ["orderId", "kind"], where: { orderId: { in: orders.map(order => order.id) }, kind: { in: ["good", "shipped"] } }, _sum: { quantity: true } });
  const draftIds = orders.flatMap(order => order.reconDrafts.map(draft => draft.id));
  const audits = await prisma.auditEvent.findMany({ where: { organizationId: actor.organizationId, entityType: "FactoryReconDraft", entityId: { in: draftIds } }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return { total, page, pageCount: Math.max(1, Math.ceil(total / 20)), rows: orders.map(order => ({
    ...previewFor(order, { shipped: totals.find(row => row.orderId === order.id && row.kind === "shipped")?._sum.quantity ?? 0, good: totals.find(row => row.orderId === order.id && row.kind === "good")?._sum.quantity ?? 0 }, policy),
    financeState: selected.find(row => row.id === order.id)!.state,
    recentChanges: audits.filter(event => event.entityId === order.reconDrafts[0]?.id).slice(0, 3).map(event => ({ id: event.id, summary: event.summary, actorName: event.actor?.name ?? "未留存", createdAt: event.createdAt })),
  })) };
}

export async function generateFactoryReconDraft(input: ReconActor & {
  orderId: string; idempotencyKey: string; expectedSnapshot?: string; unitPriceYuan?: string | null; basisNote?: string;
}) {
  if (!await canUserAction(input, "generate_factory_recon")) throw new ExecutionError("无权生成对账草稿");
  const key = input.idempotencyKey.trim();
  if (!key || key.length > 120) throw new ExecutionError("凭证标识无效");
  return prisma.$transaction(async tx => {
    if (!await canUserAction(input, "generate_factory_recon", tx)) throw new ExecutionError("无权生成对账草稿");
    await lockOrderForWrite(tx, input.organizationId, input.orderId);
    const preview = await getFactoryReconPreview(input.organizationId, input.orderId, tx);
    const existing = await tx.factoryReconDraft.findUnique({ where: { orderId: input.orderId } });
    const byKey = await tx.factoryReconDraft.findUnique({ where: { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: key } } });
    const price = input.unitPriceYuan === undefined ? preview.unitPriceYuan : input.unitPriceYuan?.trim() || null;
    const basisNote = input.basisNote === undefined ? preview.basisNote : input.basisNote.trim();
    if (price && !basisNote) throw new ExecutionError("请填写本单加工单价的核对依据");
    const computed = computeReconDraft({ shippedQty: preview.currentShippedQty, unitPriceYuan: price, basisNote });
    if (byKey) {
      if (byKey.orderId !== input.orderId || (input.unitPriceYuan !== undefined && byKey.unitPriceYuan !== computed.unitPriceYuan) || (input.basisNote !== undefined && byKey.basisNote !== computed.basisNote)) throw new ExecutionError("同一凭证标识的对账内容不一致");
      return { reused: true, draft: viewOf(byKey) };
    }
    if (input.expectedSnapshot !== undefined && input.expectedSnapshot !== preview.snapshot) throw new ExecutionError("对账预览已变化，请刷新后重新核对");
    if (preview.blockedReason) throw new ExecutionError(preview.blockedReason);
    if (existing && existing.shippedQty === computed.shippedQty && existing.unitPriceYuan === computed.unitPriceYuan && existing.amountYuan === computed.amountYuan && existing.basisNote === computed.basisNote && existing.factoryId === preview.factoryId) return { reused: true, draft: viewOf(existing) };
    const data = { factoryId: preview.factoryId, status: computed.status, shippedQty: computed.shippedQty, unitPriceYuan: computed.unitPriceYuan, amountYuan: computed.amountYuan, basisNote: computed.basisNote, paid: false, idempotencyKey: key };
    const saved = existing ? await tx.factoryReconDraft.update({ where: { id: existing.id }, data }) : await tx.factoryReconDraft.create({ data: { id: createId(), organizationId: input.organizationId, orderId: input.orderId, ...data } });
    await writeAudit({ organizationId: input.organizationId, actorUserId: input.userId, action: existing ? "recon.draft.updated" : "recon.draft.created", entityType: "FactoryReconDraft", entityId: saved.id,
      summary: `${preview.orderNo} ${existing ? "更新" : "生成"}对账草稿：${computed.shippedQty}件，${computed.amountYuan ?? "金额待核实"}元，未付款`,
      payloadJson: JSON.stringify({ before: existing ? viewOf(existing) : null, after: viewOf(saved), sourceSnapshot: preview.snapshot, idempotencyKey: key, paid: false }),
    }, tx);
    return { reused: false, draft: viewOf(saved) };
  });
}
