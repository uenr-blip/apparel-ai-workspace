import { BusinessSearchInput } from "@/components/business-search-input";
import { PartnerDirectory } from "@/components/partner-directory";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { buildCatalogHref } from "@/lib/catalog-query";
import { labels } from "@/lib/labels";
import { listInventoryLots } from "@/server/services/inventory-query";
import { canUserAction } from "@/server/services/user-permissions";
import { InventoryMoveForm } from "./inventory-move-form";
import { TodayWarehouseBoard } from "./today-board";
import { ResourceHub } from "./resource-hub";

type Params = { q?: string; locationId?: string; materialId?: string; state?: string; page?: string; view?: string; partnerKind?:string; partnerPage?:string };
export default async function ResourcesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireSession();
  const params = await searchParams;
  if (params.view === "finance") redirect(buildCatalogHref("/finance", { tab: "reconciliation", page: params.page ?? "" }, params.q ?? ""));
  const q = (params.q ?? "").trim().slice(0, 120);
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  const [canTransfer, canConsume, canFinance] = await Promise.all([
    canUserAction(actor, "inventory_transfer"), canUserAction(actor, "inventory_consume"), canUserAction(actor, "generate_factory_recon"),
  ]);
  const todayView = params.view === "today";
  const libraryView = params.view === "library";
  const partnerView = params.view === "partners" && session.role !== "factory";
  const chip = (active: boolean) =>
    active ? "rounded-full bg-[var(--brand)] px-4 py-2 text-white" : "rounded-full border border-[var(--line)] px-4 py-2";
  const tabs = <nav className="flex flex-wrap gap-2 text-sm" aria-label="资料与库存视图">
    <Link href="/resources?view=library" className={chip(libraryView)}>资料与库存首页</Link>
    <Link href="/resources?view=today" className={chip(todayView)}>今日仓</Link>
    <Link href="/resources" className={chip(!todayView && !partnerView && !libraryView)}>库存批次</Link>
    {session.role !== "factory" && <Link href="/resources?view=partners" className={chip(partnerView)}>客户 / 工厂 / 供应商</Link>}
    {session.role !== "factory" ? <Link href="/resources/material-ledger" className="rounded-full border border-[var(--line)] px-4 py-2">收料与退补</Link> : null}
    {["manager", "salesperson"].includes(session.role) ? <Link href="/resources/catalog" className="rounded-full border border-[var(--line)] px-4 py-2">新增与维护资料</Link> : null}
    {canFinance ? <Link href="/finance" className="rounded-full border border-[var(--line)] px-4 py-2">财务与对账 →</Link> : <span className="rounded-full border border-[var(--line)] px-4 py-2 text-[var(--ink-muted)]">财务与对账 · 需经理授权</span>}
  </nav>;
  if (libraryView) return <div className="space-y-7"><PageHeader title="资料与库存" description="找款式与面辅料、查往来单位、办理实物收发，都从这里进入。" /><ResourceHub factoryOnly={session.role === "factory"} /></div>;
  if (partnerView) return <div className="space-y-5"><PageHeader eyebrow="资料与库存" title="客户 / 工厂 / 供应商" description="找到业务伙伴，沿真实订单与凭证查看当前进展和历史。" actions={<BusinessAgentEntry module="workspace" initialText="查客户、工厂或供应商的当前业务和历史记录"/>}/>{tabs}<PartnerDirectory actor={actor} q={q} kind={params.partnerKind} page={params.partnerPage}/></div>;
  const factoryOnly = session.role === "factory";
  const [inventory, parties, materials, quotes] = await Promise.all([
    listInventoryLots(session.organizationId, session, { ...params, q }),
    prisma.party.findMany({ where: { organizationId: session.organizationId, ...(factoryOnly ? { id: session.factoryId ?? "" } : {}) }, orderBy: { name: "asc" }, take: 100 }),
    factoryOnly ? Promise.resolve([]) : prisma.material.findMany({ where: { organizationId: session.organizationId, ...(q ? { OR: [{ code: { contains: q } }, { name: { contains: q } }] } : {}) }, orderBy: { code: "asc" }, take: 30 }),
    factoryOnly ? Promise.resolve([]) : prisma.supplierQuote.findMany({ where: { organizationId: session.organizationId, ...(q ? { material: { OR: [{ code: { contains: q } }, { name: { contains: q } }] } } : {}) }, include: { material: true, supplier: true }, orderBy: { validFrom: "desc" }, take: 30 }),
  ]);
  const movable = inventory.rows.filter(lot => lot.canMove);
  const option = (lot: typeof inventory.rows[number]) => ({ id: lot.id, label: `${lot.materialCode} ${lot.colorName} · ${lot.locationName} · 可办理 ${lot.availableQty} ${lot.unit} · ${lot.id.slice(-6)}`, unit: lot.unit, availableQty: lot.availableQty });
  const factories = parties.filter(item => item.kind === "factory").map(item => ({ id: item.id, label: item.name }));
  const extras: Record<string, string> = {};
  for (const key of ["locationId", "materialId", "state"] as const) if (params[key]) extras[key] = params[key]!;
  const href = (page: number) => buildCatalogHref("/resources", { ...extras, page: String(page) }, q);
  const field = "h-10 rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm";
  return <div className="space-y-5">
    <PageHeader eyebrow="资料与库存" title={todayView ? "今日仓" : factoryOnly ? "本厂库存" : "库存批次"} description={todayView ? "今天该调到厂、可占余料、在途未收。调拨不是领用，在途不是现货。" : factoryOnly ? "查本厂批次的在手、占用和已登记领用，沿凭证核对来源与去向。" : "先找现有料，再核对批次与去向。查到有料不等于适用于本单，规格、颜色与使用条件仍需确认。"}
      actions={canTransfer || canConsume ? <CatalogCompose label="调拨或领用" title="调拨与领用" note="从当前筛选页选择批次；没有找到时先在列表检索。"><InventoryMoveForm lots={movable.map(option)} consumeLots={movable.filter(lot => lot.locationKind === "factory").map(option)} factories={factories} canTransfer={canTransfer} canConsume={canConsume} /></CatalogCompose> : undefined} />
    {tabs}
    {todayView ? <TodayWarehouseBoard organizationId={session.organizationId} role={session.role} factoryId={session.factoryId} /> : <>
    <form method="get" action="/resources" className="flex flex-wrap items-end gap-3" aria-label="现有料筛选">
      {params.materialId ? <input type="hidden" name="materialId" value={params.materialId} /> : null}
      <BusinessSearchInput key={q} label="找料或业务资料" defaultValue={q} placeholder="材料、颜色、地点；输入即显示候选" className="min-w-[min(180px,100%)] flex-1"/>
      <label className="text-sm">地点<select name="locationId" defaultValue={params.locationId ?? ""} className={`${field} mt-1 block`}><option value="">全部可见地点</option>{parties.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm">状态<select name="state" defaultValue={params.state ?? ""} className={`${field} mt-1 block`}><option value="">全部</option><option value="on_hand">现货记录</option><option value="inbound">在途</option><option value="hold">待核验 / 受限</option></select></label>
      <button type="submit" className="h-10 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">查找</button><Link href="/resources" className="py-2 text-sm text-[var(--brand-strong)]">清除筛选</Link>
    </form>
    <p className="text-sm text-[var(--ink-muted)]">共 {inventory.total} 批 · 本页 {inventory.rows.length} 批 · 第 {inventory.page} / {inventory.pageCount} 页</p>
    <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
      <thead className="bg-[var(--paper)]"><tr>{["材料 / 批次记录", "地点", "在手", "占用", "可办理", "在途 / 提示", ""].map((name, index) => <th key={index} className="p-3 font-medium">{name}</th>)}</tr></thead>
      <tbody>{inventory.rows.map(lot => <tr key={lot.id} className="border-t border-[var(--line)]">
        <td className="p-3"><Link href={`/resources/lots/${lot.id}`} className="font-medium text-[var(--brand-strong)]">{lot.materialCode} · {lot.colorName}</Link><p className="mt-1 text-xs text-[var(--ink-muted)]">{lot.materialName} · 记录 {lot.id.slice(-6)}</p></td>
        <td className="p-3"><Link href={`/resources/parties/${lot.locationId}`} className="text-[var(--brand-strong)]">{lot.locationName}</Link></td>
        <td className="p-3">{lot.qtyOnHand} {lot.unit}</td><td className="p-3">{lot.qtyAllocated} {lot.unit}</td><td className="p-3 font-medium">{lot.availableQty} {lot.unit}</td>
        <td className="max-w-[240px] p-3">{lot.inboundEta ? <p>{lot.qtyInbound} {lot.unit} · {lot.inboundEta}</p> : null}<p className={lot.unavailableReasons.length ? "text-[var(--warning)]" : "text-[var(--ink-muted)]"}>{lot.unavailableReasons.join("；") || "条件符合，可按实际数量办理"}</p></td>
        <td className="p-3"><Link href={`/resources/lots/${lot.id}`} className="text-[var(--brand-strong)]">查看凭证{canTransfer || canConsume ? " / 办理" : ""}</Link></td>
      </tr>)}</tbody>
    </table></div>{inventory.rows.length === 0 ? <p className="p-5 text-sm text-[var(--ink-muted)]">没有匹配的可见批次，请调整筛选。</p> : null}</Card>
    <div className="flex gap-4 text-sm">{inventory.page > 1 ? <Link href={href(inventory.page - 1)} scroll={false}>上一页</Link> : null}{inventory.page < inventory.pageCount ? <Link href={href(inventory.page + 1)} scroll={false}>下一页</Link> : null}</div>
    {!factoryOnly ? <details><summary className="cursor-pointer text-sm text-[var(--brand-strong)]">查阅关联资料与历史报价</summary><div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="p-5"><h3 className="font-medium">材料主档</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">当前最多显示30条，主档不等于库存。</p><ul className="mt-3 space-y-2 text-sm">{materials.map(item => <li key={item.id}><Link href={`/resources/materials/${item.id}`} className="text-[var(--brand-strong)]">{item.code} {item.name}</Link></li>)}</ul><Link href="/styles?tab=materials" className="mt-3 block text-sm text-[var(--brand-strong)]">进入面辅料库</Link></Card>
      <Card className="p-5"><h3 className="font-medium">供应商 / 工厂</h3><ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">{parties.map(item => <li key={item.id}><Link href={`/resources/parties/${item.id}`} className="text-[var(--brand-strong)]">{item.name}</Link> <Badge>{labels.partyKind(item.kind)}</Badge></li>)}</ul></Card>
      <Card className="p-5"><h3 className="font-medium">历史报价</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">最近30条，不等于本单确认成本。</p><ul className="mt-3 space-y-2 text-sm">{quotes.map(item => <li key={item.id}><Link href={`/resources/quotes/${item.id}`} className="text-[var(--brand-strong)]">{item.material.code} · {item.supplier.name} · {(item.unitPriceMinor / 100).toFixed(2)} {item.currency}/{item.unit}</Link></li>)}</ul></Card>
    </div></details> : null}
    </>}
  </div>;
}
