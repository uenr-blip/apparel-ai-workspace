import { StageExpenses } from "./stage-expenses";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { AmountReconciliation } from "./amount-reconciliation";
import { BridgePanel } from "./bridge-panel";
import { FinanceHome } from "./home";
import { FinanceHelp } from "./help";
import { FinanceNavigation, FinanceGuide } from "./navigation";
import { financeNavigation } from "@/lib/finance-navigation";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { LedgerHome, TreasuryPanel } from "./ledger-panels";
import { OrderCostPanel } from "./order-cost-panel";
import { MATERIAL_MOVEMENT_LABELS } from "@/lib/material-quantity";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/clock";
import { buildCatalogHref } from "@/lib/catalog-query";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { canUserAction } from "@/server/services/user-permissions";
import { listFinanceVouchers } from "@/server/services/finance-board";
import { listFinanceReconciliations } from "@/server/services/recon";
import { FINANCE_STATES, type FinanceFilter } from "@/server/services/finance-query";
import { FinanceReconForm } from "./recon-form";
import { money } from "./overview";
import { tradePermissions } from "@/server/services/trade-db";
import type { TradeFilter } from "@/server/services/trade-read";
import { TradeReceivables, TradePayables, TradeCashPanel, TradeDocumentsPanel } from "./trade-panels";

type Params = FinanceFilter & TradeFilter & { tab?: string; section?: string; kind?: string; view?: string; bookId?: string; billId?: string; type?: string; role?: string };
const field = "mt-1 h-10 w-full rounded-xl border border-[var(--line)] bg-[var(--field-solid)] px-3 text-sm";
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession(), raw = await searchParams;
  const values: Record<string, string | undefined> = Object.fromEntries(["tab", "section", "q", "page", "state", "factoryId", "kind", "view", "currency", "direction", "orderId", "partyId", "from", "to", "bookId", "billId", "type", "role", "projectId", "followRowId", "stageOnly"].map(key => [key, Array.isArray(raw[key]) ? raw[key][0] : raw[key]]));
  const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
  const [permissions, nextPermissions, canLegacy] = await Promise.all([tradePermissions(actor), ledgerPermissions(actor), canUserAction(actor, "generate_factory_recon")]);
  const navigation = financeNavigation({ trade: permissions.has("trade_view"), ledger: nextPermissions.has("ledger_view"), legacy: canLegacy }, values);
  if (!navigation.groups.length) return <PageHeader title="财务与对账" description="当前账号未获财务查阅权限，请经理在设置中下发。" />;
  const tab = navigation.tab, params: Params = { ...values, view: navigation.view };
  const titles: Record<string, string> = { home: "财务工作台", business: "业务对账", funds: "收付与结汇", accounting: "会计账务", costs: "订单成本" };
  const descriptions: Record<string, string> = { home: "从要办的事开始，核对款项、记录收付、追溯订单成本。", business: "先核对客户、供应商和工厂的款项，再查看对应业务依据。", funds: "记录已发生的收付款、退款和币种兑换，关联对应款项。", accounting: "处理业务入账、会计凭证与账簿，专业设置在账簿内办理。", costs: "按订单查看材料、加工和其他费用，追到每项业务依据。" };
  return <div className="min-w-0 space-y-5">
    <PageHeader eyebrow="财务与对账" title={tab === "help" ? "使用帮助" : titles[navigation.section]} description={tab === "help" ? "按要办的事找入口，了解常见操作与用语。" : descriptions[navigation.section]} actions={<>{permissions.has("trade_view") ? <BusinessAgentEntry module="finance" /> : null}<Link href={tab === "help" ? "/finance" : "/finance?tab=help"} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-[var(--brand-strong)]">{tab === "help" ? "返回财务工作台" : "使用帮助"}</Link></>} />
    <FinanceNavigation navigation={navigation} />
    {navigation.denied ? <Card className="p-5 text-sm">当前账号没有该工作区的查阅权限，请经理按职责下发。其他已授权工作区仍可使用。</Card> : tab === "help" ? <FinanceHelp navigation={navigation} /> : tab === "overview" ? <FinanceHome actor={actor} /> : <>
      <FinanceGuide navigation={navigation} />
      {tab === "expenses" ? <StageExpenses actor={actor} permissions={permissions} filter={params} /> : tab === "receivables" ? <TradeReceivables actor={actor} permissions={permissions} filter={params} /> : tab === "payables" ? <TradePayables actor={actor} permissions={permissions} filter={params} /> : tab === "cash" ? <TradeCashPanel actor={actor} permissions={permissions} filter={params} /> : tab === "documents" ? <TradeDocumentsPanel actor={actor} permissions={permissions} filter={params} /> : tab === "costs" ? <OrderCostPanel actor={actor} orderId={params.orderId} permissions={permissions} /> : tab === "amounts" ? <AmountReconciliation actor={actor} query={params} /> : tab === "bridge" ? <BridgePanel actor={actor} bookId={params.bookId} filter={params} /> : tab === "ledger" ? <LedgerHome actor={actor} permissions={nextPermissions} /> : tab === "treasury" ? <TreasuryPanel actor={actor} permissions={nextPermissions} view={params.view} page={params.page} q={params.q} /> : tab === "reconciliation" ? <Reconciliations actor={actor} params={params} /> : <Vouchers actor={actor} params={params} />}
    </>}
  </div>;
}

async function Reconciliations({ actor, params }: { actor: Parameters<typeof listFinanceReconciliations>[0]; params: Params }) {
  const data = await listFinanceReconciliations(actor, params);
  const q = (params.q ?? "").trim().slice(0, 100);
  const href = (page: number) => buildCatalogHref("/finance", { tab: "reconciliation", state: params.state ?? "", factoryId: params.factoryId ?? "", page: String(page) }, q);
  return <section className="space-y-4">
    <form action="/finance" className="flex flex-wrap items-end gap-3"><input type="hidden" name="tab" value="reconciliation" />{params.factoryId ? <input type="hidden" name="factoryId" value={params.factoryId} /> : null}
      <label className="min-w-40 flex-1 text-sm">查找对账<input name="q" defaultValue={q} maxLength={100} className={field} placeholder="订单号、客户或工厂" /></label>
      <label className="text-sm">处理状态<select name="state" defaultValue={params.state ?? ""} className={field}><option value="">全部状态</option><option value="pending">全部待处理</option>{Object.entries(FINANCE_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="h-10 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">查找</button><Link href="/finance?tab=reconciliation" className="py-2 text-sm text-[var(--brand-strong)]">清除筛选</Link>
    </form>
    <p className="text-xs leading-6 text-[var(--ink-muted)]">共 {data.total} 张订单 · 金额为已存加工草稿，未生成应付或付款{params.factoryId ? " · 已按草稿工厂筛选" : ""}</p>
    <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["订单 / 客户", "加工工厂", "当前出运", "已存草稿金额 · CNY", "处理状态", "操作"].map(title => <th key={title} className="p-4 font-medium">{title}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.orderId} className="border-t border-[var(--line)] align-top">
      <td className="p-4"><Link href={`/orders/${row.orderId}`} className="font-medium text-[var(--brand-strong)]">{row.orderNo}</Link><p className="mt-1 text-xs text-[var(--ink-muted)]">{row.customerName}</p></td>
      <td className="p-4">{row.factoryName}</td><td className="p-4 tabular-nums">{row.currentShippedQty} 件{row.draft ? <p className="mt-1 text-xs text-[var(--ink-muted)]">草稿按 {row.draft.shippedQty} 件</p> : null}</td>
      <td className="p-4 tabular-nums"><strong>{money(row.draft?.amountYuan ?? null)}</strong><p className="mt-1 text-xs text-[var(--ink-muted)]">单价 {row.unitPriceYuan ?? "待确认"} / 件</p></td>
      <td className="p-4"><Badge tone={row.financeState === "saved" ? "neutral" : "warning"}>{FINANCE_STATES[row.financeState]}</Badge>{row.blockedReason ? <p className="mt-2 max-w-40 text-xs text-[var(--ink-muted)]">{row.blockedReason}</p> : null}</td>
      <td className="p-4"><CatalogCompose label="核对草稿" title={`${row.orderNo} · 工厂加工对账`} note="核对出运、单价与依据，保存后保留修改记录。"><FinanceReconForm preview={row} /><div className="mt-5 space-y-3 border-t border-[var(--line)] pt-4"><Link href={`/orders/${row.orderId}`} className="text-sm text-[var(--brand-strong)]">查看订单来源 →</Link>{row.recentChanges.map(event => <p key={event.id} className="text-xs leading-6 text-[var(--ink-muted)]">{formatDateTime(event.createdAt)} · {event.actorName}<br />{event.summary}</p>)}</div></CatalogCompose></td>
    </tr>)}</tbody></table></div>{!data.rows.length ? <p className="p-8 text-center text-sm text-[var(--ink-muted)]">当前筛选下没有加工对账记录。</p> : null}</Card>
    <Pagination page={data.page} pageCount={data.pageCount} href={href} />
  </section>;
}

async function Vouchers({ actor, params }: { actor: Parameters<typeof listFinanceVouchers>[0]; params: Params }) {
  const data = await listFinanceVouchers(actor, params), q = (params.q ?? "").trim().slice(0, 100);
  const href = (page: number) => buildCatalogHref("/finance", { tab: "vouchers", kind: params.kind ?? "", page: String(page) }, q);
  return <section className="space-y-4"><form action="/finance" className="flex flex-wrap items-end gap-3"><input type="hidden" name="tab" value="vouchers" /><label className="min-w-40 flex-1 text-sm">查找凭证<input name="q" defaultValue={q} maxLength={100} className={field} placeholder="材料、地点或凭证备注" /></label><label className="text-sm">业务类型<select name="kind" defaultValue={params.kind ?? ""} className={field}><option value="">全部</option><option value="transfer">调拨</option><option value="consume">领用</option></select></label><button className="h-10 rounded-xl bg-[var(--brand)] px-4 text-sm text-[var(--on-brand)]">查找</button><Link href="/finance?tab=vouchers" className="py-2 text-sm text-[var(--brand-strong)]">清除筛选</Link></form>
    <Link href="/resources/material-ledger" className="block text-sm text-[var(--brand-strong)]">收料、退补与耗用归单 →</Link><p className="text-xs leading-6 text-[var(--ink-muted)]">共 {data.total} 条材料业务凭证 · 用于核对流转，不是会计凭证，也不直接计入订单成本。</p>
    <Card className="min-w-0 overflow-hidden"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--paper)]"><tr>{["时间 / 经办人", "材料", "类型 / 数量", "来源 → 去向", "备注 / 追溯"].map(title => <th key={title} className="p-4 font-medium">{title}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.id} className="border-t border-[var(--line)] align-top"><td className="p-4">{formatDateTime(row.createdAt)}<p className="mt-1 text-xs text-[var(--ink-muted)]">{row.actorName}</p></td><td className="p-4">{row.materialCode ?? "历史材料"}<p className="mt-1 text-xs text-[var(--ink-muted)]">{row.materialName ?? "资料未留存"}</p></td><td className="p-4"><Badge>{MATERIAL_MOVEMENT_LABELS[row.kind] ?? row.kind}</Badge><p className="mt-2 tabular-nums">{row.qty} {row.unit ?? "单位未留存"}</p></td><td className="p-4">{row.fromName ?? "未留存"}<p className="mt-1 text-xs text-[var(--ink-muted)]">→ {row.kind === "consume" ? "本厂领用" : row.toName ?? "未留存"}</p></td><td className="max-w-64 break-words p-4"><p className="text-xs leading-6 text-[var(--ink-muted)]">{row.note ?? "无备注"}</p>{row.fromLotId || row.toLotId ? <Link href={`/resources/lots/${row.fromLotId ?? row.toLotId}`} className="mt-2 block text-xs text-[var(--brand-strong)]">查看来源批次 →</Link> : null}</td></tr>)}</tbody></table></div>{!data.rows.length ? <p className="p-8 text-center text-sm text-[var(--ink-muted)]">当前筛选下没有材料业务凭证。</p> : null}</Card><Pagination page={data.page} pageCount={data.pageCount} href={href} />
  </section>;
}
function Pagination({ page, pageCount, href }: { page: number; pageCount: number; href: (page: number) => string }) {
  return <nav aria-label="分页" className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-[var(--ink-muted)]">第 {page} / {pageCount} 页 · 每页 20 条</span><div className="flex gap-5">{page > 1 ? <Link href={href(page - 1)}>上一页</Link> : null}{page < pageCount ? <Link href={href(page + 1)}>下一页</Link> : null}</div></nav>;
}
