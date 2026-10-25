import { notFound } from "next/navigation";
import { MATERIAL_MOVEMENT_LABELS } from "@/lib/material-quantity";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/clock";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { getLotRecord, ResourceRecordError } from "@/server/services/resource-records";
import { canUserAction } from "@/server/services/user-permissions";
import { InventoryMoveForm } from "../../inventory-move-form";

export default async function LotDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ movementPage?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  let record;
  try { record = await getLotRecord(session.organizationId, id, session, query.movementPage ?? 1); }
  catch (error) { if (error instanceof ResourceRecordError) notFound(); throw error; }
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  const [canTransfer, canConsume] = await Promise.all([canUserAction(actor, "inventory_transfer"), canUserAction(actor, "inventory_consume")]);
  const factories = canTransfer ? await prisma.party.findMany({ where: { organizationId: session.organizationId, kind: "factory", id: { not: record.locationId } }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } }) : [];
  const lot = { id: record.id, label: `${record.materialCode} ${record.colorName} · ${record.locationName}`, unit: record.unit, availableQty: record.availableQty };
  const href = (page: number) => `/resources/lots/${record.id}?movementPage=${page}`;
  return <div className="space-y-5">
    <PageHeader eyebrow="批次记录" title={`${record.materialCode} ${record.colorName}`} description={`${record.materialName} · ${record.locationName} · 记录 ${record.id.slice(-6)}`}
      actions={(canTransfer || (canConsume && record.locationKind === "factory")) && record.canMove ? <CatalogCompose label="办理本批次" title="本批次调拨 / 领用" note="按实际数量确认，原有凭证保留。"><InventoryMoveForm lots={[lot]} consumeLots={record.locationKind === "factory" ? [lot] : []} factories={factories.map(item => ({ id: item.id, label: item.name }))} canTransfer={canTransfer} canConsume={canConsume && record.locationKind === "factory"} defaultMode={record.locationKind === "factory" ? "consume" : "transfer"} /></CatalogCompose> : undefined} />
    <div className="flex flex-wrap gap-3 text-sm"><Link href="/resources" className="text-[var(--brand-strong)]">返回现有料</Link><Link href={`/resources?materialId=${record.materialId}`} className="text-[var(--brand-strong)]">查这款材料其他可见批次</Link>{session.role !== "factory" ? <Link href={`/resources/materials/${record.materialId}`} className="text-[var(--brand-strong)]">材料主档</Link> : null}</div>
    <Card className="p-5"><dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
      <div><dt className="text-[var(--ink-muted)]">所在地点</dt><dd className="mt-1"><Link href={`/resources/parties/${record.locationId}`} className="text-[var(--brand-strong)]">{record.locationName}</Link> <Badge>{record.locationKindLabel}</Badge></dd></div>
      <div><dt className="text-[var(--ink-muted)]">在手 / 占用</dt><dd className="mt-1">{record.qtyOnHand} / {record.qtyAllocated} {record.unit}</dd></div>
      <div><dt className="text-[var(--ink-muted)]">当前可办理</dt><dd className="mt-1 font-medium">{record.availableQty} {record.unit}</dd></div>
      <div><dt className="text-[var(--ink-muted)]">本批次累计已登记领用</dt><dd className="mt-1">{record.recordedConsumedQty ?? "历史数量需核对"} {record.recordedConsumedQty !== null ? record.unit : ""}</dd></div>
      <div><dt className="text-[var(--ink-muted)]">在途</dt><dd className="mt-1">{record.qtyInbound} {record.unit}{record.inboundEta ? ` · ${record.inboundEta}` : ""}</dd></div>
    </dl><p className="mt-4 text-xs text-[var(--ink-muted)]">累计只包含已登记的领用凭证，调拨不计入消耗；未登记的历史不会被推算补齐。</p>{record.unavailableReasons.length ? <p className="mt-2 text-sm text-[var(--warning)]">暂不能办理：{record.unavailableReasons.join("；")}</p> : null}</Card>
    <Card className="p-5"><h3 className="font-medium">占用到哪一单</h3><ul className="mt-3 space-y-2 text-sm">
      {!record.allocations.length ? <li className="text-[var(--ink-muted)]">{record.qtyAllocated !== "0" ? "有占用，当前权限范围内没有可展示的订单明细。" : "当前没有占用记录。"}</li> : null}
      {record.allocations.map(row => <li key={row.id}><Link href={`/orders/${row.orderId}`} className="text-[var(--brand-strong)]">{row.orderNo}</Link> · {row.qty} {record.unit} · {row.status === "held" ? "已占用" : row.status === "planned" ? "在途预留" : row.status}</li>)}
    </ul></Card>
    <Card className="min-w-0 overflow-hidden"><div className="p-5"><h3 className="font-medium">批次凭证</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">共 {record.movementTotal} 条 · 第 {record.movementPage} / {record.movementPageCount} 页。登记人来自当时的操作记录。</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["时间 / 凭证", "动作", "数量", "从哪里 → 到哪里", "登记人", "备注"].map(title => <th key={title} className="p-3 font-medium">{title}</th>)}</tr></thead><tbody>
        {record.movements.map(row => <tr key={row.id} className="border-t border-[var(--line)]"><td className="p-3">{formatDateTime(row.createdAt)}<span className="mt-1 block text-xs text-[var(--ink-muted)]">{row.id.slice(-8)}</span></td><td className="p-3">{MATERIAL_MOVEMENT_LABELS[row.kind] ?? row.kind}</td><td className="p-3">{row.qty} {record.unit}</td><td className="p-3">{row.fromLocationName} → {row.kind === "consume" ? "实际耗用" : row.toLocationName}{session.role !== "factory" && row.fromLotId && row.fromLotId !== record.id ? <Link href={`/resources/lots/${row.fromLotId}`} className="mt-1 block text-xs text-[var(--brand-strong)]">查看来源批次</Link> : null}{session.role !== "factory" && row.toLotId && row.toLotId !== record.id ? <Link href={`/resources/lots/${row.toLotId}`} className="mt-1 block text-xs text-[var(--brand-strong)]">查看调入批次</Link> : null}</td><td className="p-3">{row.actorName}</td><td className="max-w-[240px] p-3">{row.note ?? "—"}</td></tr>)}
      </tbody></table></div>{record.movements.length === 0 ? <p className="p-5 text-sm text-[var(--ink-muted)]">还没有调拨或领用凭证。</p> : null}
      <div className="flex gap-4 p-5 text-sm">{record.movementPage > 1 ? <Link href={href(record.movementPage - 1)} scroll={false}>上一页</Link> : null}{record.movementPage < record.movementPageCount ? <Link href={href(record.movementPage + 1)} scroll={false}>下一页</Link> : null}</div>
    </Card>
  </div>;
}
