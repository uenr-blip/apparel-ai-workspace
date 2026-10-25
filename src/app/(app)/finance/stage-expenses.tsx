import Link from "next/link";
import { CatalogCompose } from "@/components/catalog-compose";
import { listTradeBills, tradeToday, type TradeFilter } from "@/server/services/trade-read";
import type { TradeActor } from "@/server/services/trade-contract";
import { StageExpenseForm } from "./stage-expense-form";
import { TradeBillsTable, TradePagination, TradeSearch } from "./trade-panels";
export async function StageExpenses({ actor, permissions, filter }: { actor: TradeActor; permissions: Set<string>; filter: TradeFilter }) {
  const scoped = { ...filter, direction: "payable", stageOnly: "1" };
  const [data, today] = await Promise.all([listTradeBills(actor, scoped), tradeToday(actor)]);
  const params = new URLSearchParams(Object.fromEntries(Object.entries(scoped).filter(([key, v]) => key !== "page" && v !== undefined).map(([k, v]) => [k, String(v)])));
  params.set("kind", "bills");
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-[var(--ink-muted)]">共 {data.total} 笔 · 草稿待核对，确认后计入应付。费用不自动转入大货成本。</p><div className="flex flex-wrap gap-3">{permissions.has("trade_prepare") ? <CatalogCompose label="登记阶段费用" title="登记开发 / 销售样 / 大货阶段费用"><StageExpenseForm today={today} /></CatalogCompose> : null}{permissions.has("trade_export") ? <a className="py-2 text-sm text-[var(--brand-strong)]" href={`/api/finance/trade/export?${params}`}>导出当前筛选 CSV</a> : null}</div></div><TradeSearch tab="expenses" filter={scoped} type="bills" /><TradeBillsTable rows={data.rows} /><TradePagination data={data} tab="expenses" filter={scoped} /><Link className="block text-sm text-[var(--brand-strong)]" href="/finance?tab=cash">登记已发生付款 →</Link></section>;
}
