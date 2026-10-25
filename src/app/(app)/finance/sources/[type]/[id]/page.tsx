import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { TradeError } from "@/lib/trade-money";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { getLedgerSourceBridge, BRIDGE_STATES, SOURCE_TYPES, sourceBridgeHref } from "@/server/services/ledger-bridge";
import { listLedgerBooks } from "@/server/services/ledger-read";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { tradePermissions } from "@/server/services/trade-db";
import { SourceJournalForm } from "../../../ledger-forms";

export default async function SourcePage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<{ bookId?: string; page?: string }> }) {
  const session = await requireSession(), { type, id } = await params, query = await searchParams;
  if (!Object.hasOwn(SOURCE_TYPES,type)) notFound();
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  const [ledger, trade] = await Promise.all([ledgerPermissions(actor), tradePermissions(actor)]);
  if (!ledger.has("ledger_view") || !trade.has("trade_view")) return <PageHeader title="业务记账关联" description="需同时具备外贸财务与总账查阅权限，请经理下发。" />;
  const books = await listLedgerBooks(actor);
  if (!books.length) return <div className="space-y-4"><PageHeader title="业务记账关联" description="尚未建立演示账套，原业务记录保留。" /><Link href="/finance?tab=ledger" className="text-[var(--brand-strong)]">进入总账创建账套 →</Link></div>;
  let data;
  try { data = await getLedgerSourceBridge(actor, query.bookId || books[0].id, type, id, query.page); } catch (error) { if (error instanceof TradeError && error.status === 404) notFound(); throw error; }
  const { source, book } = data;
  return <div className="min-w-0 space-y-5">
    <Link href={`/finance?tab=bridge&bookId=${encodeURIComponent(book.id)}`} className="text-sm text-[var(--brand-strong)]">← 业务入账</Link>
    <PageHeader title={source.label} eyebrow={SOURCE_TYPES[type as keyof typeof SOURCE_TYPES]} description={`${source.currency} ${source.amount} · 来源日期 ${source.occurredOn.slice(0, 10)}`} actions={source.canPrepare && ledger.has("ledger_prepare") ? <CatalogCompose label="从本来源制单" title="核对来源、科目与记账依据"><SourceJournalForm bookId={book.id} baseCurrency={book.baseCurrency} fixedSource={{ type, id, label: source.label, currency: source.currency }} /></CatalogCompose> : undefined} />
    <form className="flex flex-wrap items-center gap-3" action={sourceBridgeHref(type, id)}><label className="max-w-full text-sm">当前账套 <select name="bookId" defaultValue={book.id} className="ml-2 h-10 max-w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3">{books.map(b => <option key={b.id} value={b.id}>{b.name} · {b.baseCurrency}</option>)}</select></label><button className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm text-[var(--on-brand)]">切换账套</button></form>
    <Card className="space-y-3 p-5"><Badge tone={source.state === "changed" ? "warning" : source.state === "posted" ? "ok" : "neutral"}>{BRIDGE_STATES[source.state]}</Badge>{source.issue ? <p className="text-sm leading-7">{source.issue}。原凭证保留；业务变化须通过相应差异或反向凭证处理。</p> : null}
      <Link href={source.businessHref} className="block text-sm text-[var(--brand-strong)]">查阅与处理业务原件 →</Link>
      {source.journalId ? <Link href={`/finance/journals/${source.journalId}`} className="block text-sm text-[var(--brand-strong)]">当前关联凭证 {source.journalNumber ?? "草稿"} →</Link> : null}
      <div className="flex flex-wrap gap-3">{data.orders.map(o => <Link key={o.id} href={`/finance?tab=bridge&bookId=${book.id}&orderId=${o.id}`} className="text-sm text-[var(--brand-strong)]">{o.orderNo} 业务与总账 →</Link>)}</div>
      <p className="text-xs leading-6 text-[var(--ink-muted)]">{source.orderId ? "直接关联本业务订单。" : "资金按有效核销关联订单，可跨订单；这里显示整笔来源金额，不重复分摊到每一单。未分配资金可能暂时没有订单。"}{data.moreOrders ? "关联订单超过100项，此处显示前100项。" : ""}</p>
    </Card>
    <Card className="min-w-0 overflow-hidden"><h3 className="p-5 font-semibold">本账套凭证历史 · 共 {data.historyCount} 条</h3><div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["凭证 / 日期", "摘要", "状态", "类型"].map(x => <th key={x} className="p-4">{x}</th>)}</tr></thead><tbody>{data.history.map(j => <tr key={j.id} className="border-t border-[var(--line)]"><td className="p-4"><Link href={`/finance/journals/${j.id}`} className="text-[var(--brand-strong)]">{j.number ?? "未过账草稿"} →</Link><p className="mt-1 text-xs">{j.date}</p></td><td className="p-4">{j.summary}</td><td className="p-4">{({ draft: "草稿", reviewed: "已复核", posted: "已过账", void: "已作废" } as Record<string, string>)[j.status]}</td><td className="p-4">{j.reversesId ? "反向凭证" : "来源凭证"}</td></tr>)}</tbody></table></div>{!data.history.length ? <p className="p-5 text-sm text-[var(--ink-muted)]">本账套尚无该来源的关联凭证。</p> : null}</Card>
    <nav className="flex justify-between text-sm"><span>第 {data.page} / {data.pageCount} 页</span><div className="flex gap-4">{data.page > 1 ? <Link href={sourceBridgeHref(type, id, book.id) + `&page=${data.page - 1}`}>上一页</Link> : null}{data.page < data.pageCount ? <Link href={sourceBridgeHref(type, id, book.id) + `&page=${data.page + 1}`}>下一页</Link> : null}</div></nav>
    <p className="text-xs leading-6 text-[var(--ink-muted)]">这里只跟踪明确关联的来源凭证；手工凭证不自动认领来源。已过账不代表业务余额和总账已经对平。</p>
  </div>;
}
