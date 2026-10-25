import Link from "next/link";
import { Card } from "@/components/ui/card";
import { CatalogCompose } from "@/components/catalog-compose";
import { StageExpenseForm } from "@/app/(app)/finance/stage-expense-form";
import { TradeBillsTable } from "@/app/(app)/finance/trade-panels";
import { tradePermissions } from "@/server/services/trade-db";
import { tradeToday } from "@/server/services/trade-read";
import { getStageExpenses, type ExpenseTarget } from "@/server/services/stage-expenses";
import type { TradeActor } from "@/server/services/trade-contract";

export async function StageExpensePanel({ actor, target }: { actor: TradeActor; target: ExpenseTarget }) {
  const permissions = await tradePermissions(actor);
  if (!permissions.has("trade_view")) return null;
  const [data, today] = await Promise.all([getStageExpenses(actor, target), tradeToday(actor)]);
  const own = data.rows.filter(r => !r.inherited), inherited = data.rows.filter(r => r.inherited);
  return <Card id="stage-expenses" className="scroll-mt-8 space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">阶段费用</h3><p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">费用按发生阶段留存，交接后可回查；分摊由财务逐笔决定。</p></div>{data.subject.canCreate && permissions.has("trade_prepare") ? <CatalogCompose label="登记费用" title="登记本阶段费用"><StageExpenseForm fixedSubject={data.subject} today={today} /></CatalogCompose> : null}</div>
    {data.subject.orderId ? <p className="text-sm">本款已开生产单，新增费用请到<Link className="ml-1 underline" href={`/finance/orders/${data.subject.orderId}`}>本单财务</Link>登记；此前阶段费用保留在这里。</p> : null}
    <details open={own.length > 0}><summary className="cursor-pointer text-sm">本阶段费用 · {own.length} 笔</summary><div className="mt-3"><TradeBillsTable rows={own} /></div></details>
    {inherited.length ? <details><summary className="cursor-pointer text-sm">交接来源费用 · {inherited.length} 笔（仅供回查，未分摊到本阶段）</summary><div className="mt-3"><TradeBillsTable rows={inherited} /></div></details> : null}
    <Link href="/finance?tab=expenses" className="block text-xs text-[var(--brand-strong)]">到财务核对阶段费用与凭据 →</Link>
  </Card>;
}
