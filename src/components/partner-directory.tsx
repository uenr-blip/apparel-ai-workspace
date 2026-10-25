import Link from "next/link";
import type { TradeActor } from "@/server/services/trade-contract";
import { searchBusiness } from "@/server/services/business-search";
import { SEARCH_LABELS } from "@/lib/business-search";
import { CatalogSearch } from "@/components/catalog-search";
import { AgentResultTable } from "@/components/agent-result-table";
export async function PartnerDirectory({actor,q,kind:raw,page}:{actor:TradeActor;q:string;kind?:string;page?:string}) {
 const kind=raw==="factory"||raw==="supplier"?raw:"customer";
 const result=await searchBusiness(actor,q,{kind,page:Number(page),allowEmpty:true});
 const href=(k:string,p=1)=>`/resources?${new URLSearchParams({view:"partners",partnerKind:k,q:result.query,partnerPage:String(p)})}`;
 return <section className="space-y-4"><nav className="flex gap-4 text-sm" aria-label="业务伙伴类别">{["customer","factory","supplier"].map(k=><Link key={k} href={href(k)} aria-current={kind===k?"page":undefined} className={kind===k?"font-semibold underline":"text-[var(--ink-muted)]"}>{SEARCH_LABELS[k as keyof typeof SEARCH_LABELS]} {result.counts[k as keyof typeof result.counts]||0}</Link>)}</nav><CatalogSearch action="/resources" q={result.query} extras={{view:"partners",partnerKind:kind}} placeholder="名称或编号，输入即显示候选"/>
 <AgentResultTable table={{title:`${SEARCH_LABELS[kind]} · ${result.total} 家`,columns:["编号 / 名称","可以核对"],rows:result.items.map(i=>({href:i.href,cells:[`${i.code} ${i.name}`,kind==="customer"?"在做订单、订单品牌、草稿与历史":kind==="factory"?"在做产品、产量进展、阻塞事项、打样与历史":"供料、退供、关联订单和历史报价"]})),emptyMessage:"没有匹配的可见记录"}}/>
 <div className="flex gap-4 text-sm"><span>第 {result.page} / {result.pageCount} 页</span>{result.page>1&&<Link href={href(kind,result.page-1)}>上一页</Link>}{result.page<result.pageCount&&<Link href={href(kind,result.page+1)}>下一页</Link>}</div></section>;
}
