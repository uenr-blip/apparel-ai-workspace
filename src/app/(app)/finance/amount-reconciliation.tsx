import Link from "next/link";
import { Card, Badge } from "@/components/ui/card";
import { CatalogCompose } from "@/components/catalog-compose";
import { formatDateTime } from "@/lib/clock";
import { TradeError } from "@/lib/trade-money";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { listLedgerBooks } from "@/server/services/ledger-read";
import { BALANCE_STATES, getReconciliationLines, getReconciliationReport } from "@/server/services/reconciliation-report";
import { SOURCE_MONEY_STATES } from "@/server/services/reconciliation-sources";
import { RECON_ROLES, requireReconciliation } from "@/server/services/reconciliation-rules";
import { SOURCE_TYPES, sourceBridgeHref } from "@/server/services/ledger-bridge";
import type { TradeActor } from "@/server/services/trade-contract";
import { ReconciliationRuleForm } from "./reconciliation-rule-form";
type Query = { bookId?: string; view?: string; q?: string; state?: string; page?: string | number; role?: string };
const field = "h-10 w-full min-w-0 rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm";
export async function AmountReconciliation({ actor, query }: { actor: TradeActor; query: Query }) {
  try { return await ReconciliationContent({ actor, query }); }
  catch (error) { if (error instanceof TradeError) return <Card className="p-5 text-sm">{error.message}<Link href="/finance?tab=amounts" className="mt-3 block text-[var(--brand-strong)]">重新选择账簿 →</Link></Card>; throw error; }
}
async function ReconciliationContent({ actor, query }: { actor: TradeActor; query: Query }) {
  await requireReconciliation(actor);
  const books = await listLedgerBooks(actor), grants = await ledgerPermissions(actor);
  if (!books.length) return <Card className="space-y-3 p-5"><h3 className="font-semibold">先选择要核对的会计账簿</h3><p className="text-sm leading-7 text-[var(--ink-muted)]">金额核对比较业务台账与会计记录。业务对账和收付登记仍可先使用。</p><Link href="/finance?tab=ledger" className="block text-sm text-[var(--brand-strong)]">建立或选择演示账簿 →</Link></Card>;
  const report = await getReconciliationReport(actor, query.bookId || books[0].id, query), book = report.book, view = ["sources", "lines"].includes(query.view ?? "") ? query.view! : "balances";
  const href = (values: Record<string, string>) => "/finance?" + new URLSearchParams({ tab: "amounts", bookId: book.id, ...values });
  const source = report.sourceReport;
  const lineData = view === "lines" ? await getReconciliationLines(actor, book.id, query.role ?? "", String(query.page ?? "1")) : null;
  return <section className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><form action="/finance" className="flex max-w-full items-end gap-2"><input type="hidden" name="tab" value="amounts" /><input type="hidden" name="view" value={view === "lines" ? "balances" : view} /><label className="grid min-w-0 gap-1 text-xs">核对账簿<select name="bookId" defaultValue={book.id} className={field}>{books.map(b => <option key={b.id} value={b.id}>{b.name} · {b.baseCurrency}</option>)}</select></label><button className="h-10 shrink-0 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">切换</button></form>
      {grants.has("ledger_config") ? <CatalogCompose label="配置核对口径" title="配置演示金额核对口径"><ReconciliationRuleForm bookId={book.id} baseCurrency={book.baseCurrency} rule={report.rule} selections={report.rows.map(r => ({ role: r.role, label: r.label, accounts: r.accounts }))} /></CatalogCompose> : null}
    </div>
    <p className="text-xs leading-6 text-[var(--ink-muted)]">{report.scope} · 本位币 {book.baseCurrency} · {formatDateTime(report.generatedAt)}<br />{report.rule ? `核对口径第${report.rule.version}版：${report.rule.basis}` : "尚未配置对账科目；来源凭证的金额核对可以先查看。"}公司总额核对尚未覆盖逐客户、供应商或银行的辅助明细。</p>
    <nav aria-label="金额核对方式" className="flex flex-wrap gap-4 text-sm"><Link href={href({ view: "balances" })} className={view === "balances" ? "font-semibold text-[var(--brand-strong)]" : ""}>科目金额对照</Link><Link href={href({ view: "sources" })} className={view === "sources" ? "font-semibold text-[var(--brand-strong)]" : ""}>来源凭证核对</Link></nav>
    <div className="flex flex-wrap gap-2"><Badge tone={report.gaps.pendingSources ? "warning" : "neutral"}>来源待处理 {report.gaps.pendingSources}</Badge><Badge tone={report.gaps.changedSources ? "warning" : "neutral"}>业务依据变化 {report.gaps.changedSources}</Badge><Badge tone={report.gaps.unvalued + report.gaps.unassigned ? "warning" : "neutral"}>缺价 / 未归单 {report.gaps.unvalued} / {report.gaps.unassigned}</Badge>{report.gaps.orphanJournals ? <Badge tone="warning">凭证来源缺失 {report.gaps.orphanJournals}</Badge> : null}</div>
    {view === "balances" ? <>
      <div className="grid gap-4 lg:grid-cols-2">{report.rows.map(r => <Card key={r.role} className="min-w-0 space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{r.label}</h3><Badge tone={r.status === "matched" ? "ok" : ["empty", "unmapped"].includes(r.status) ? "neutral" : "warning"}>{BALANCE_STATES[r.status]}</Badge></div>
        <dl className="grid grid-cols-3 gap-2 text-xs"><div><dt className="leading-5 text-[var(--ink-muted)]">业务折算 · {book.baseCurrency}</dt><dd className="mt-2 break-words text-lg tabular-nums">{r.business ?? "待补汇率"}</dd></div><div><dt className="leading-5 text-[var(--ink-muted)]">总账核对额</dt><dd className="mt-2 break-words text-lg tabular-nums">{r.actual ?? "待选科目"}</dd></div><div><dt className="leading-5 text-[var(--ink-muted)]">差额：总账 − 业务</dt><dd className="mt-2 break-words text-lg tabular-nums">{r.difference ?? "—"}</dd></div></dl>
        {r.status === "incomplete" ? <p className="text-xs leading-6 text-[var(--warning)]">这里只列已知金额，仍有业务缺项或依据变化，不能认定对平。</p> : null}
        <div className="space-y-1 border-t border-[var(--line)] pt-3 text-xs">{r.originals.map(o => <p key={o.currency}>{o.currency} {o.amount} · {o.rate ? `核对汇率 ${o.rate}` : "未配核对汇率"} → {book.baseCurrency} {o.converted ?? "待核对"}</p>)}{!r.originals.length ? <p className="text-[var(--ink-muted)]">暂无已登记的该类业务金额。</p> : null}</div>
        {r.manualCount ? <p className="text-xs leading-6">涉及手工分录 {r.manualCount} 行，净额 {book.baseCurrency} {r.manualAmount}{r.role === "funds" ? "（另列，未纳入资金净变动比较）" : "（已计入总账金额，需核对来源）"}</p> : null}
        <p className="text-xs leading-6 text-[var(--ink-muted)]">{r.note}</p>
        <div className="flex flex-wrap gap-4 text-xs text-[var(--brand-strong)]"><Link href={href({ view: "lines", role: r.role })}>查看总账分录 →</Link><Link href={r.role === "receivable" ? "/finance?tab=receivables&view=bills" : r.role === "payable" ? "/finance?tab=payables" : r.role === "funds" ? "/finance?tab=cash" : "/finance?tab=costs"}>查阅业务依据 →</Link></div>
      </Card>)}</div>
      {report.rule?.rates.length ? <Card className="space-y-2 p-4 text-xs"><h3 className="font-semibold">本次核对汇率依据</h3>{report.rule.rates.map(r => <p key={r.currency}>1 {r.currency} = {r.rate} {book.baseCurrency} · {r.date} · {r.basis}</p>)}<p className="leading-6 text-[var(--ink-muted)]">仅用于演示比较，不自动调整凭证或完成外币重估。折算时点、舍入及成本结转口径都可能形成需解释的差异。</p></Card> : null}
    </> : view === "sources" ? <>
      <form action="/finance" className="flex flex-wrap items-end gap-3"><input type="hidden" name="tab" value="amounts" /><input type="hidden" name="bookId" value={book.id} /><input type="hidden" name="view" value="sources" /><label className="grid min-w-40 flex-1 gap-1 text-xs">订单 / 来源<input name="q" defaultValue={query.q ?? ""} maxLength={100} className={field} /></label><label className="grid gap-1 text-xs">核对结果<select name="state" defaultValue={query.state ?? ""} className={field}><option value="">全部</option><option value="pending">全部待处理</option>{Object.entries(SOURCE_MONEY_STATES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><button className="h-10 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">查找</button></form>
      <p className="text-xs leading-6 text-[var(--ink-muted)]">共 {source.total} 条（全部来源 {source.allCount} 条）。按原凭证留存汇率或账面依据复算；金额为分录借贷合计，不能相加当作业务收入。草稿和已完成冲销不算有效入账。</p>
      <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["业务来源 / 原币", "业务按原凭证依据折算", "原凭证依据复算", "有效入账借 / 贷", "差额", "结果 / 凭证"].map(t => <th key={t} className="p-4 font-medium">{t}</th>)}</tr></thead><tbody>{source.rows.map(r => <tr key={r.type + r.id} className="border-t border-[var(--line)] align-top"><td className="max-w-64 p-4"><Link href={sourceBridgeHref(r.type, r.id, book.id)} className="text-[var(--brand-strong)]">{r.label}</Link><p className="mt-1 text-xs">{SOURCE_TYPES[r.type as keyof typeof SOURCE_TYPES]} · {r.orderNo ?? "资金来源"}</p><p className="mt-2">{r.currency} {r.amount}</p></td><td className="p-4">{r.expected ?? "待确定"}</td><td className="p-4">{r.frozen ?? "尚无依据"}</td><td className="p-4">{r.actual}<br />{r.actualCredit}</td><td className="p-4">{r.difference ?? "—"}</td><td className="max-w-64 space-y-2 p-4"><Badge tone={r.status === "matched" ? "ok" : "warning"}>{SOURCE_MONEY_STATES[r.status]}</Badge>{r.issue ? <p className="text-xs leading-6">{r.issue}</p> : null}{r.journalId ? <Link href={`/finance/journals/${r.journalId}`} className="block text-xs text-[var(--brand-strong)]">{r.number ?? "查看凭证草稿"} →</Link> : null}</td></tr>)}</tbody></table></div>{!source.rows.length ? <p className="p-6 text-sm text-[var(--ink-muted)]">当前筛选没有可列出的来源；这不代表全部业务已入账。</p> : null}</Card>
      <Pagination page={source.page} pageCount={source.pageCount} href={p => href({ view: "sources", q: query.q ?? "", state: query.state ?? "", page: String(p) })} />
    </> : lineData ? <>
      <h3 className="font-semibold">{RECON_ROLES[query.role as keyof typeof RECON_ROLES]} · 已过账分录</h3><p className="text-xs text-[var(--ink-muted)]">共 {lineData.total} 行；反向分录保留。资金中的手工分录标为另列。</p>
      <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["凭证", "科目 / 摘要", "借方", "贷方", "处理口径"].map(t => <th key={t} className="p-4">{t}</th>)}</tr></thead><tbody>{lineData.rows.map((r, i) => <tr key={r.id + i} className="border-t border-[var(--line)]"><td className="p-4"><Link className="text-[var(--brand-strong)]" href={`/finance/journals/${r.id}`}>{r.number}</Link><p className="mt-1 text-xs">{r.date}</p></td><td className="p-4">{r.account}<p className="mt-1 text-xs">{r.summary}</p></td><td className="p-4">{r.debit}</td><td className="p-4">{r.credit}</td><td className="p-4">{r.excluded ? "手工资金另列" : r.manual ? "手工项计入，待核对" : "业务来源分录"}</td></tr>)}</tbody></table></div></Card><Pagination page={lineData.page} pageCount={lineData.pageCount} href={p => href({ view: "lines", role: query.role ?? "", page: String(p) })} />
    </> : null}
    <p className="text-xs leading-6 text-[var(--ink-muted)]">金额一致只说明本页明确范围内的数值相同。未映射业务、手工来源、往来辅助明细、银行原始流水及真实会计税务规则仍须核对。</p>
  </section>;
}
function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (p: number) => string }) {
  return <nav className="flex flex-wrap justify-between gap-3 text-sm"><span>第 {page} / {pageCount} 页 · 每页20条</span><div className="flex gap-4">{page > 1 ? <Link href={href(page - 1)}>上一页</Link> : null}{page < pageCount ? <Link href={href(page + 1)}>下一页</Link> : null}</div></nav>;
}
