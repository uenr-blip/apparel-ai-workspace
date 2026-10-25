import { receiptOptions } from "./material-lookup";
import { prisma } from "@/lib/db";
import { requireTrade } from "./trade-db";
import { listTradeBills, listTradeCash } from "./trade-read";
import type { TradeActor } from "./trade-contract";
import { TradeError } from "@/lib/trade-money";

export type TradeOption = { colorName?:string; id: string; label: string; currency?: string; amount?: string; version?: number; partyId?: string; direction?: string };
export async function tradeLookup(actor: TradeActor, params: { kind: string; q?: string; orderId?: string; partyId?: string; direction?: string }): Promise<TradeOption[]> {
  await requireTrade(actor);
  const q = (params.q ?? "").trim().slice(0, 100), org = actor.organizationId;
  if (params.kind === "expense_projects") return (await prisma.developmentProject.findMany({ where: { organizationId: org, archivedAt: null, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}) }, orderBy: { updatedAt: "desc" }, take: 20 })).map(p => ({ id: p.id, label: `${p.code} · ${p.name}` }));
  if (["expense_sales", "expense_bulk"].includes(params.kind)) return (await prisma.orderMerchStyle.findMany({ where: { productionLineId: null, sheet: { organizationId: org, archivedAt: null, kind: params.kind === "expense_sales" ? "sales_sample" : "bulk" }, ...(q ? { OR: [{ styleCode: { contains: q } }, { styleName: { contains: q } }, { sheet: { title: { contains: q } } }] } : {}) }, include: { sheet: true }, orderBy: { sheet: { updatedAt: "desc" } }, take: 20 })).map(r => ({ id: r.id, label: `${r.styleCode} ${r.styleName} · ${r.sheet.title}` }));
  if (params.kind === "receipts") return receiptOptions(actor, params.orderId ?? "", q);
  if (params.kind === "orders") {
    const rows = await prisma.salesOrder.findMany({ where: { organizationId: org, ...(q ? { OR: [{ orderNo: { contains: q } }, { customer: { name: { contains: q } } }] } : {}) }, include: { customer: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 20 });
    return rows.map(row => ({ id: row.id, label: `${row.orderNo} · ${row.customer.name}` }));
  }
  if (params.kind === "customers") return (await prisma.customer.findMany({ where: { organizationId: org, ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}) }, take: 20, orderBy: { name: "asc" } })).map(row => ({ id: row.id, label: row.name }));
  if (params.kind === "parties") return (await prisma.party.findMany({ where: { organizationId: org, kind: { in: ["supplier", "factory"] }, ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}) }, take: 20, orderBy: { name: "asc" } })).map(row => ({ id: row.id, label: row.name }));
  if (["cash", "cash_records"].includes(params.kind)) return (await listTradeCash(actor, { q, partyId: params.partyId, direction: params.direction, state: params.kind === "cash_records" ? "recorded" : "unallocated" })).rows.map(row => ({ id: row.id, label: `${row.bankReference} · ${row.partyName} · 可分配 ${row.currency} ${row.unallocatedAmount}`, currency: row.currency, amount: row.unallocatedAmount, version: row.version, partyId: row.partyId, direction: row.direction }));
  if (params.kind === "bills") return (await listTradeBills(actor, { q, orderId: params.orderId, partyId: params.partyId, direction: params.direction })).rows.filter(row => row.status !== "void").map(row => ({ id: row.id, label: `${row.orderNo} · ${row.title} · ${row.currency} ${row.openAmount}`, currency: row.currency, amount: row.openAmount, version: row.version, partyId: row.partyId, direction: row.direction }));
  if (["packing", "recons", "purchases"].includes(params.kind)) {
    if (!params.orderId) return [];
    if (params.kind === "packing") return (await prisma.packingPlan.findMany({ where: { organizationId: org, orderId: params.orderId, status: "shipped", ...(q ? { id: { contains: q } } : {}) }, take: 20, orderBy: { createdAt: "desc" } })).map(row => ({ id: row.id, label: `${row.id.slice(-8)} · 已出运 ${row.totalQty}件 · ${row.note ?? ""}` }));
    if (params.kind === "recons") return (await prisma.factoryReconDraft.findMany({ where: { organizationId: org, orderId: params.orderId, status: "draft", paid: false }, take: 20 })).map(row => ({ id: row.id, label: `${row.id.slice(-8)} · CNY ${row.amountYuan ?? "待核实"} · 加工草稿`, currency: "CNY", amount: row.amountYuan ?? "", partyId: row.factoryId ?? "" }));
    return (await prisma.purchaseDraft.findMany({ where: { organizationId: org, orderId: params.orderId, status: "draft", ...(q ? { material: { name: { contains: q } } } : {}) }, include: { material: { select: { name: true } } }, take: 20 })).map(row => ({ id: row.id, label: `${row.material.name} · CNY ${row.amountYuan} · 采购草稿`, currency: "CNY", amount: row.amountYuan }));
  }
  throw new TradeError("不支持的查找类型");
}
