import Link from "next/link";
import { sourceBridgeHref } from "@/server/services/ledger-bridge";
import { requireSession } from "@/lib/auth";
import { Card,Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { getLedgerJournal } from "@/server/services/ledger-read";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { formatMoney, TradeError } from "@/lib/trade-money";
import { formatDateTime } from "@/lib/clock";
import { JournalForm,LedgerActionForm } from "../../ledger-forms";
export default async function JournalPage({params}:{params:Promise<{id:string}>}){
 const s=await requireSession(),{id}=await params,actor={organizationId:s.organizationId,userId:s.id,role:s.role,factoryId:s.factoryId},grants=await ledgerPermissions(actor);let j;
 try{j=await getLedgerJournal(actor,id);}catch(error){if(error instanceof TradeError)return <PageHeader title="总账凭证" description={error.message}/>;throw error;}
 return <div className="min-w-0 space-y-5"><Link href={`/finance/ledger/${j.bookId}`} className="text-sm text-[var(--brand-strong)]">← {j.book.name}</Link><PageHeader title={j.number??`凭证草稿 ${j.id.slice(-6)}`} description={`${j.date} · ${j.summary}`} actions={<Badge tone={j.status==="posted"?"ok":"warning"}>{{draft:"草稿",reviewed:"已复核",posted:"已过账",void:"已作废"}[j.status]} · 演示账套</Badge>}/>
 <Card className="space-y-4 p-5"><p className="whitespace-pre-wrap text-sm leading-7">{j.basis}</p><p className="text-sm">制单 {j.creatorName} · 复核 {j.reviewerName} · 过账 {j.posterName}</p><div className="flex flex-wrap gap-3">{["draft","reviewed"].includes(j.status)&&(j.createdBy===s.id||grants.has("ledger_config"))&&grants.has("ledger_prepare")?<>{!j.reversesId&&j.createdBy===s.id?<CatalogCompose label="修订草稿" title="修订凭证并重新复核"><JournalForm bookId={j.bookId} baseCurrency={j.book.baseCurrency} journal={j}/></CatalogCompose>:null}<CatalogCompose label="作废草稿" title="作废未过账凭证"><LedgerActionForm action="void_journal" id={id} version={j.version} label="作废草稿"/></CatalogCompose></>:null}
 {j.status==="draft"&&grants.has("ledger_review")&&j.createdBy!==s.id?<CatalogCompose label="复核凭证" title="独立复核凭证"><LedgerActionForm action="review_journal" id={id} version={j.version} label="确认复核"/></CatalogCompose>:null}
 {j.status==="reviewed"&&grants.has("ledger_post")?<CatalogCompose label="过账" title="核对后过账"><LedgerActionForm action="post_journal" id={id} version={j.version} label="确认过账"/></CatalogCompose>:null}
 {j.status==="posted"&&!j.reversedById&&grants.has("ledger_prepare")?<CatalogCompose label="生成反向凭证" title="保留原凭证的反向更正"><LedgerActionForm action="reverse_journal" id={id} version={j.version} label="生成反向草稿"/></CatalogCompose>:null}</div>
 {j.status==="draft"&&j.createdBy===s.id?<p className="text-sm text-[var(--ink-muted)]">需要另一位获总账复核权限的同事复核。经理可在设置中分配权限。</p>:null}{j.reversedById?<Link className="block text-sm text-[var(--brand-strong)]" href={`/finance/journals/${j.reversedById}`}>查看已过账的反向凭证 →</Link>:null}{j.reversesId?<Link className="block text-sm text-[var(--brand-strong)]" href={`/finance/journals/${j.reversesId}`}>查看原凭证 →</Link>:null}{j.voidReason?<p className="text-sm">作废：{j.voidReason}</p>:null}
 </Card>
 <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["科目","分录说明",`借方 ${j.book.baseCurrency}`,`贷方 ${j.book.baseCurrency}`].map(t=><th key={t} className="p-4 font-medium">{t}</th>)}</tr></thead><tbody>{j.lines.map(l=><tr key={l.id} className="border-t border-[var(--line)]"><td className="p-4">{l.code} {l.name}</td><td className="p-4">{l.note}</td><td className="p-4 tabular-nums">{l.debit}</td><td className="p-4 tabular-nums">{l.credit}</td></tr>)}<tr className="border-t border-[var(--line)] font-semibold"><td className="p-4">合计</td><td className="p-4">{j.balanced?"借贷平衡":"未平衡，不能复核或过账"}</td><td className="p-4">{j.debit}</td><td className="p-4">{j.credit}</td></tr></tbody></table></div></Card>
 {j.sourceId && j.sourceType!=="reversal"?<Link href={sourceBridgeHref(j.sourceType,j.sourceId,j.bookId)} className="block text-sm text-[var(--brand-strong)]">查看当前业务状态与全部关联凭证 →</Link>:null}
 {j.sourceJson?<SourceEvidence json={j.sourceJson} type={j.sourceType} sourceId={j.sourceId} currency={j.book.baseCurrency} total={j.expectedTotal}/>:null}
 <Card className="p-5"><h3 className="font-semibold">操作留痕（最近20条）</h3><ul className="mt-3 space-y-3 text-xs leading-6 text-[var(--ink-muted)]">{j.events.map(e=><li key={e.id}>{e.summary}<br/>{e.actor?.name??"未留存"} · {formatDateTime(e.createdAt)}</li>)}</ul></Card>
 </div>;
}

function SourceEvidence({json,type,sourceId,currency,total}:{json:string;type:string;sourceId:string|null;currency:string;total:string|null}){
 const snapshot=JSON.parse(json) as {facts:Record<string,unknown>;rate:string;rateDate:string;carryingAmount:string},f=snapshot.facts;
 const originalCurrency=String(f.currency??f.fromCurrency??""),minor=(type==="adjustment"&&f.adjustment&&typeof f.adjustment==="object"?(f.adjustment as {amount?:string}).amount:undefined)??f.amount??f.originalAmount??f.fromMinor;
 const values=[["来源类型",({cash:"原始收付",bill:"业务原单",adjustment:"独立扣补",refund:"退款",fx:"结汇/换汇"} as Record<string,string>)[type]??type],["来源编号",sourceId??""],["原币金额",minor&&originalCurrency?`${originalCurrency} ${formatMoney(String(minor),originalCurrency)}`:""],["来源日期",String(f.occurredOn??"")],["银行流水号",String(f.reference??"")],[type==="fx"?"银行实际换汇汇率":"原币折算本位币汇率",type==="fx"?String(f.rate):snapshot.rate||"同币种1"],["核对日期",snapshot.rateDate],["外币账面本位币金额",snapshot.carryingAmount?`${currency} ${snapshot.carryingAmount}`:""],["凭证应匹配总额",`${currency} ${total}`]];
 const href=type==="bill"?`/finance/bills/${sourceId}`:type==="adjustment"?`/finance/bills/${String(f.billId)}`:type==="cash"?`/finance?tab=cash&q=${encodeURIComponent(String(f.reference??""))}`:`/finance?tab=treasury&view=${type==="fx"?"fx":"refund"}&q=${encodeURIComponent(String(f.reference??""))}`;
 return <Card className="p-5"><h3 className="font-semibold">来源快照与折算依据</h3><Link href={href} className="mt-3 block text-sm text-[var(--brand-strong)]">查阅业务来源 →</Link><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">{values.filter(([,v])=>v).map(([label,value])=><div key={label}><dt className="text-xs text-[var(--ink-muted)]">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-6 text-[var(--ink-muted)]">留存制单当时的来源数据。凭证未过账时，系统会在复核和过账时重新核对来源状态。</p></Card>;
}
