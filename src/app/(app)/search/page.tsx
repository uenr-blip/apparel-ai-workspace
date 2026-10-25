import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { SEARCH_KINDS,SEARCH_LABELS,searchHref,type SearchKind } from "@/lib/business-search";
import { searchBusiness } from "@/server/services/business-search";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogSearch } from "@/components/catalog-search";
import { AgentResultTable } from "@/components/agent-result-table";
export default async function SearchPage({searchParams}:{searchParams:Promise<{q?:string;kind?:string;page?:string}>}) {
 const session=await requireSession(),params=await searchParams,kind=SEARCH_KINDS.includes(params.kind as SearchKind)?params.kind as SearchKind:undefined;
 const result=await searchBusiness({organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId},params.q,{kind,page:Number(params.page)});
 return <div className="space-y-5"><PageHeader title="查找业务资料" description="按名称、编号或已有品牌查找；输入一个字也能匹配。打开原记录继续核对。"/><CatalogSearch action="/search" q={result.query} placeholder="毛、DEV-02、材料名、客户名…" extras={kind?{kind}:{}}/>
  <nav aria-label="检索类别" className="flex flex-wrap gap-3 text-sm"><Link aria-current={!kind?"page":undefined} href={searchHref(result.query)}>全部</Link>{SEARCH_KINDS.map(k=><Link key={k} aria-current={kind===k?"page":undefined} className={kind===k?"font-semibold underline":"text-[var(--ink-muted)]"} href={searchHref(result.query,k)}>{SEARCH_LABELS[k]} {result.counts[k]||0}</Link>)}</nav>
  <p className="text-sm text-[var(--ink-muted)]">匹配 {result.total} 条 · 第 {result.page} / {result.pageCount} 页</p><AgentResultTable table={{title:"匹配的业务资料",columns:["编号 / 名称","类别","已有说明"],rows:result.items.map(i=>({href:i.href,cells:[`${i.code} ${i.name}`,SEARCH_LABELS[i.kind],i.detail||"未另作说明"]})),emptyMessage:result.query?"没有匹配的可见资料":"请输入要查找的字或编号"}}/>
  <div className="flex gap-4 text-sm">{result.page>1&&<Link href={searchHref(result.query,kind,result.page-1)}>上一页</Link>}{result.page<result.pageCount&&<Link href={searchHref(result.query,kind,result.page+1)}>下一页</Link>}</div>
 </div>;
}
