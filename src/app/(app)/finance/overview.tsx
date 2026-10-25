import Link from "next/link";
import { ArrowUpRight, FileCheck2, ReceiptText, CircleAlert, Banknote } from "lucide-react";
import { Card, Badge } from "@/components/ui/card";
import { formatDateTime } from "@/lib/clock";
import { buildCatalogHref } from "@/lib/catalog-query";
import { FINANCE_STATES, type FinanceState } from "@/server/services/finance-query";
import type { getFinanceOverview } from "@/server/services/finance-board";

export function money(value: string | null) { return value === null ? "—" : value.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
const colors: Record<FinanceState, string> = { missing: "var(--ai)", basis: "var(--gold)", changed: "var(--warning)", review: "var(--danger)", saved: "var(--brand)" };
const stateHref = (state: string) => buildCatalogHref("/finance", { tab: "reconciliation", state });

export function FinanceOverview({ data }: { data: Awaited<ReturnType<typeof getFinanceOverview>> }) {
  const metrics = [
    { label: "待处理订单", value: String(data.pendingCount), note: "生成、补依据或重新核对", href: stateHref("pending"), icon: CircleAlert },
    { label: "已存加工草稿金额", value: money(data.amountYuan), note: "CNY · 已存草稿口径，含待重核草稿", href: "/finance?tab=reconciliation", icon: Banknote },
    { label: "加工对账草稿", value: String(data.draftCount), note: `覆盖 ${data.orderCount} 张有出运或草稿的订单`, href: "/finance?tab=reconciliation", icon: FileCheck2 },
    { label: "材料业务凭证", value: String(data.voucherCount), note: "调拨、领用的来源与去向", href: "/finance?tab=vouchers", icon: ReceiptText },
  ];
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metrics.map((item, i) => <Link key={item.label} href={item.href} className="group min-w-0 rounded-[var(--radius)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]">
      <Card className={`flex h-full flex-col p-5 transition-transform group-hover:-translate-y-0.5 ${i === 1 ? "border-[var(--brand)]/25" : ""}`}>
        <div className="flex items-center justify-between gap-2 text-sm text-[var(--ink-muted)]"><span>{item.label}</span><item.icon size={18} aria-hidden="true" /></div>
        <p className="my-5 break-words text-[clamp(1.6rem,2.7vw,2.65rem)] font-medium leading-none tracking-tight tabular-nums">{item.value}</p>
        <p className="mt-auto flex items-center justify-between gap-2 text-xs leading-5 text-[var(--ink-muted)]">{item.note}<ArrowUpRight size={15} className="shrink-0" aria-hidden="true" /></p>
      </Card>
    </Link>)}</div>
    {data.excludedDraftCount > 0 ? <p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--surface-solid)] px-4 py-3 text-sm">有 {data.excludedDraftCount} 份草稿缺少有效金额或含异常标记，未计入金额汇总。请在工厂对账中核对。</p> : null}
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">加工草稿金额 · 按工厂</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">人民币 CNY · 按草稿留存工厂 · 金额最高的 5 家</p></div><Badge>已存草稿</Badge></div>
        {data.factories.length ? <div className="mt-7 space-y-6">{data.factories.map((factory, i) => <Link key={factory.id ?? "unknown"} href={buildCatalogHref("/finance", { tab: "reconciliation", factoryId: factory.id ?? "" })} className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm"><span>{factory.name} <span className="text-xs text-[var(--ink-muted)]">{factory.count} 份</span></span><span className="font-medium tabular-nums">¥ {money(factory.amountYuan)}</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-[var(--paper-2)]"><div className="h-full rounded-full" style={{ width: `${factory.width}%`, background: i % 2 ? "var(--gold)" : "var(--brand)" }} /></div>
        </Link>)}</div> : <EmptyChart title="还没有可汇总的加工金额" note="从已有出运订单核对单价，保存草稿后自动汇总。" href="/finance?tab=reconciliation" label="查看待核对订单" />}
        <p className="mt-6 border-t border-[var(--line)] pt-3 text-xs leading-5 text-[var(--ink-muted)]">这里统计已保存的加工草稿，不代表总成本、已确认应付或已付款。材料数量不折算为成本。</p>
      </Card>
      <Card className="p-5 sm:p-6"><h3 className="font-semibold">对账处理分布</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">当前登记范围 · {data.orderCount} 张订单 · 点状态查看明细</p>
        <div className="mt-7 flex h-3 gap-1 overflow-hidden rounded-full bg-[var(--paper-2)]" aria-hidden="true">{Object.entries(data.states).map(([state, count]) => count ? <div key={state} style={{ width: `${count / data.orderCount * 100}%`, background: colors[state as FinanceState] }} /> : null)}</div>
        <div className="mt-5 space-y-1">{Object.entries(FINANCE_STATES).map(([state, label]) => <Link key={state} href={stateHref(state)} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-[var(--brand-soft)]"><span className="h-2 w-2 rounded-full" style={{ background: colors[state as FinanceState] }} /><span className="flex-1">{label}</span><strong className="tabular-nums">{data.states[state as FinanceState]}</strong><ArrowUpRight size={14} className="text-[var(--ink-muted)]" /></Link>)}</div>
      </Card>
    </div>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <Card className="p-5 sm:p-6"><div className="flex justify-between gap-3"><h3 className="font-semibold">先处理这些</h3><Link href={stateHref("pending")} className="text-xs text-[var(--brand-strong)]">查看全部 →</Link></div><p className="mt-1 text-xs text-[var(--ink-muted)]">异常与变化优先 · 最多显示 6 项</p>
        <div className="mt-4 divide-y divide-[var(--line)]">{data.pending.map(row => <Link key={row.id} href={buildCatalogHref("/finance", { tab: "reconciliation" }, row.orderNo)} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="text-sm font-medium">{row.orderNo}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{row.factoryName ?? "未指定工厂"}</p></div><Badge tone={row.state === "review" || row.state === "changed" ? "warning" : "neutral"}>{FINANCE_STATES[row.state]}</Badge></Link>)}{!data.pending.length ? <p className="py-8 text-sm text-[var(--ink-muted)]">当前没有待处理项。已有草稿仍需按实际业务核对。</p> : null}</div>
      </Card>
      <Card className="p-5 sm:p-6"><h3 className="font-semibold">最近留痕</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">对账草稿与材料操作 · 最近 5 条</p><ul className="mt-5 space-y-5">{data.events.map(event => <li key={event.id} className="border-l-2 border-[var(--line-strong)] pl-3"><p className="break-words text-sm leading-6">{event.summary}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{event.actor?.name ?? "未留存"} · {formatDateTime(event.createdAt)}</p></li>)}</ul>{!data.events.length ? <p className="py-8 text-sm text-[var(--ink-muted)]">尚无操作记录，保存草稿或登记材料流转后在这里留痕。</p> : null}</Card>
    </div>
  </div>;
}

function EmptyChart({ title, note, href, label }: { title: string; note: string; href: string; label: string }) {
  return <div className="flex min-h-52 flex-col items-center justify-center text-center"><ReceiptText size={30} className="mb-3 text-[var(--ink-muted)]" /><p className="text-sm font-medium">{title}</p><p className="mt-2 max-w-sm text-xs leading-6 text-[var(--ink-muted)]">{note}</p><Link href={href} className="mt-4 text-sm text-[var(--brand-strong)]">{label} →</Link></div>;
}

export function FinanceRoadmap() {
  return <details className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface-solid)]/60 px-5 py-4"><summary className="cursor-pointer text-sm font-medium">功能范围与正式启用说明</summary><p className="mt-3 text-sm leading-7 text-[var(--ink-muted)]">当前可登记应收应付、已发生收付、退款和结汇，并在演示账套内制单、独立复核、过账、冲销及试算。真实企业科目、期初、收入税务确认、损益结转与外币重估仍需财务核对；银行交易和税务申报未接通。业务凭证不会未经核对自动进入总账，试算平衡不等于业务已经完整入账。</p></details>;
}
