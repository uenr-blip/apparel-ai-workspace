import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CatalogKind, CATALOG_NAMES, listCatalog } from "@/server/services/catalog-maintenance";
import { CatalogEditor } from "./catalog-editor";
export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; archived?: string; id?: string }> }) {
  const u = await requireSession(); if (!["manager", "salesperson"].includes(u.role)) notFound();
  const p = await searchParams, kind = CatalogKind.safeParse(p.kind ?? "customer").data ?? "customer", archived = p.archived === "1";
  const rows = await listCatalog({ organizationId: u.organizationId, userId: u.id, role: u.role }, kind, p.q?.slice(0, 100), archived);
  return <div className="space-y-5"><PageHeader eyebrow="资料与库存" title="资料维护" description="新增、修正和归档业务资料。历史订单、版本与凭证保留，修改均记录操作者和原因。" actions={<Link className="text-sm underline" href="/resources?view=library">返回资料与库存</Link>} /><form className="flex flex-wrap items-end gap-3 text-sm"><label>资料类型<select className="ml-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2" name="kind" defaultValue={kind}>{CatalogKind.options.map(k => <option key={k} value={k}>{CATALOG_NAMES[k]}</option>)}</select></label><label>查找<input className="ml-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] p-2" name="q" defaultValue={p.q} placeholder="编号或名称" /></label><label><input type="checkbox" name="archived" value="1" defaultChecked={archived} /> 查看归档资料</label><button className="rounded-lg border border-[var(--line)] px-3 py-2">查找</button></form><Card className="p-4"><CatalogEditor key={`${kind}:${archived}`} kind={kind} name={CATALOG_NAMES[kind]} rows={rows} selectedId={p.id} /></Card></div>;
}
