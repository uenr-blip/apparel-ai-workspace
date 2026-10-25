import Link from "next/link";
import { Card, Badge } from "@/components/ui/card";
import { TradeError } from "@/lib/trade-money";
import { listLedgerBooks } from "@/server/services/ledger-read";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { tradePermissions } from "@/server/services/trade-db";
import { BRIDGE_STATES, SOURCE_TYPES, listLedgerBridge, sourceBridgeHref, type BridgeFilter } from "@/server/services/ledger-bridge";
import type { TradeActor } from "@/server/services/trade-contract";

const field = "h-10 min-w-0 w-full max-w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm";
export async function BridgePanel({ actor, bookId, filter = {}, compact = false }: { actor: TradeActor; bookId?: string; filter?: BridgeFilter; compact?: boolean }) {
  const [trade, ledger] = await Promise.all([tradePermissions(actor), ledgerPermissions(actor)]);
  if (!trade.has("trade_view") || !ledger.has("ledger_view")) return compact ? null : <Card className="p-5 text-sm">需同时具备外贸财务和总账查阅权限。</Card>;
  const books = await listLedgerBooks(actor);
  if (!books.length) return compact ? <p className="text-sm leading-7 text-[var(--ink-muted)]">需要查看会计记账时，<Link href="/finance?section=accounting" className="text-[var(--brand-strong)]">进入会计账务 →</Link></p> : <Card className="space-y-3 p-5"><h3 className="font-semibold">开始会计记账</h3><p className="text-sm leading-7 text-[var(--ink-muted)]">还未建立会计账簿。一个账簿保存一家企业的一套会计记录；业务对账和收付款登记可以先使用。</p><Link href="/finance?tab=ledger" className="inline-flex rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm text-[var(--on-brand)]">建立或选择会计账簿 →</Link></Card>;
  const selected = bookId || books[0].id;
  let data;
  try { data = await listLedgerBridge(actor, selected, filter); } catch (error) {
    if (error instanceof TradeError) return <Card className="space-y-3 p-5"><p role="status" className="text-sm">{error.message}</p><Link href="/finance?tab=bridge" className="block text-sm text-[var(--brand-strong)]">重新选择账套 →</Link><Link href="/orders" className="block text-sm text-[var(--brand-strong)]">按订单进入财务记账状态 →</Link></Card>;
    throw error;
  }
  const url = (extra: Record<string, string>) => {
    const query = new URLSearchParams({ tab: "bridge", bookId: selected, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])), ...extra });
    return `/finance?${query}`;
  };
  const rows = compact ? data.rows.slice(0, 6) : data.rows;
  return <section className="min-w-0 space-y-4" aria-label="业务与总账衔接">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">业务入账进度</h3><p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">当前账套：{data.book.name} · {data.book.baseCurrency} · 演示账套。状态按本账套计算。</p></div>{compact ? <Link href={url({ page: "1" })} className="text-sm text-[var(--brand-strong)]">切换账套 / 查阅全部 →</Link> : null}</div>
    {!compact ? <form action="/finance" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tab" value="bridge" />{filter.orderId ? <input type="hidden" name="orderId" value={filter.orderId} /> : null}{filter.billId ? <input type="hidden" name="billId" value={filter.billId} /> : null}
      <label className="grid max-w-full gap-1 text-xs">账套<select name="bookId" defaultValue={selected} className={field}>{books.map(b => <option key={b.id} value={b.id}>{b.name} · {b.baseCurrency}</option>)}</select></label>
      <label className="grid gap-1 text-xs">处理状态<select name="state" defaultValue={filter.state ?? ""} className={field}><option value="">全部</option><option value="pending">全部待处理</option><option value="unprepared">待制单 / 冲销后待核对</option>{Object.entries(BRIDGE_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">来源类型<select name="type" defaultValue={filter.type ?? ""} className={field}><option value="">全部类型</option>{Object.entries(SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="grid min-w-40 flex-1 gap-1 text-xs">订单号 / 款项 / 流水号<input name="q" defaultValue={filter.q ?? ""} maxLength={100} className={field} /></label>
      <button className="h-10 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">查找</button><Link href="/finance?tab=bridge" className="py-2 text-sm text-[var(--brand-strong)]">清除筛选</Link>
    </form> : null}
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[
      ["待制单 / 冲销后待核对", (data.counts.ready ?? 0) + (data.counts.reversed ?? 0), "ready"],
      ["凭证草稿", data.counts.draft ?? 0, "draft"], ["待过账", data.counts.reviewed ?? 0, "reviewed"],
      ["来源待核对", data.counts.changed ?? 0, "changed"], ["已过账", data.counts.posted ?? 0, "posted"],
    ].map(([label, value, state]) => <Link key={String(state)} href={url({ state: state === "ready" ? "unprepared" : String(state), page: "1" })}><Card className="h-full p-4"><p className="text-xs leading-5 text-[var(--ink-muted)]">{label}</p><p className="mt-2 text-2xl font-medium tabular-nums">{value}</p></Card></Link>)}</div>
    <p className="text-xs leading-6 text-[var(--ink-muted)]">本筛选共 {data.total} 条来源。原单与扣补分别制单；收付款金额为整笔流水，不是本单分摊。订单关联资金来自有效核销，未分配资金在全局清单查阅。计数反映记账进度，不代表总账与业务金额已经对平。</p>
    <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["业务来源", "订单 / 关联方式", "来源原币金额", "记账状态", "关联凭证 / 办理"].map(x => <th key={x} className="p-4 font-medium">{x}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.type + row.id} className="border-t border-[var(--line)] align-top">
      <td className="max-w-64 break-words p-4"><Link href={sourceBridgeHref(row.type, row.id, selected)} className="font-medium text-[var(--brand-strong)]">{row.label}</Link><p className="mt-1 text-xs text-[var(--ink-muted)]">{SOURCE_TYPES[row.type as keyof typeof SOURCE_TYPES]} · {row.occurredOn.slice(0, 10)}</p></td>
      <td className="p-4">{row.orderId ? <Link href={`/orders/${row.orderId}`} className="text-[var(--brand-strong)]">{row.orderNo}</Link> : <span className="text-xs text-[var(--ink-muted)]">按核销关联，可跨订单</span>}</td>
      <td className="p-4 tabular-nums">{row.currency} {row.amount}</td><td className="max-w-60 p-4"><Badge tone={row.state === "posted" ? "ok" : row.state === "changed" ? "warning" : "neutral"}>{BRIDGE_STATES[row.state]}</Badge>{row.issue ? <p className="mt-2 text-xs leading-6">{row.issue}</p> : null}</td>
      <td className="space-y-2 p-4">{row.journalId ? <Link href={`/finance/journals/${row.journalId}`} className="block text-xs text-[var(--brand-strong)]">{row.journalNumber ?? "查看关联凭证草稿"} →</Link> : null}<Link href={sourceBridgeHref(row.type, row.id, selected)} className="block text-xs text-[var(--brand-strong)]">{row.canPrepare && ledger.has("ledger_prepare") ? "核对来源并制单" : "查看来源与凭证记录"} →</Link></td>
    </tr>)}</tbody></table></div>{!rows.length ? <p className="p-6 text-sm text-[var(--ink-muted)]">当前筛选没有记录。出运、耗用及手工凭证尚无完整自动映射，不能据此认定全部业务均已入账。</p> : null}</Card>
    {compact ? data.total > rows.length ? <Link href={url({ page: "1" })} className="block text-sm text-[var(--brand-strong)]">查阅其余来源 →</Link> : null : <nav className="flex flex-wrap justify-between gap-3 text-sm"><span>第 {data.page} / {data.pageCount} 页 · 每页20条</span><div className="flex gap-4">{data.page > 1 ? <Link href={url({ page: String(data.page - 1) })}>上一页</Link> : null}{data.page < data.pageCount ? <Link href={url({ page: String(data.page + 1) })}>下一页</Link> : null}</div></nav>}
  </section>;
}
