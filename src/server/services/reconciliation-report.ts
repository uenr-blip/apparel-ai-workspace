import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { comparisonAmount } from "@/lib/reconciliation-money";
import { formatMoney, TradeError } from "@/lib/trade-money";
import { ledgerBook } from "./ledger-db";
import { requireReconciliation, readReconciliationRule, RECON_ROLES, type ReconRole } from "./reconciliation-rules";
import { changedBusinessBills } from "./ledger-business-check";
import { readBusinessAmounts } from "./reconciliation-business";
import { readSourceComparisons } from "./reconciliation-sources";
import { resourcePage } from "./resource-scope";
import type { TradeActor } from "./trade-contract";

export const BALANCE_STATES = { matched: "金额一致", difference: "金额有差异", unmapped: "待选对账科目", needs_rate: "待补核对汇率", incomplete: "业务依据不完整", pending_source: "总额一致 · 来源待处理", manual_review: "金额一致 · 手工项待核对", empty: "暂无可核对记录" };
export async function getReconciliationReport(actor: TradeActor, bookId: string, filter: { q?: string; state?: string; page?: string | number } = {}) {
  await requireReconciliation(actor);
  return prisma.$transaction(async db => {
    await requireReconciliation(actor, db);
    const book = await ledgerBook(db, actor.organizationId, bookId);
    const [volume] = await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM GLJournal WHERE bookId=${book.id} AND status='posted'`;
    if (Number(volume.n)>5000) throw new TradeError("当前金额核对支持5000张已过账凭证以内，未返回截断结论");
    const rule = await readReconciliationRule(db, actor.organizationId, book.id);
    const issues = await changedBusinessBills(db, actor);
    const sources = await readSourceComparisons(db, book, [...issues.keys()]);
    const business = await readBusinessAmounts(db, actor.organizationId);
    const selected = rule ? Object.values(rule.accounts).flat() : [];
    const accounts = selected.length ? await db.$queryRaw<Array<{ id: string; code: string; name: string; category: string }>>(Prisma.sql`SELECT id,code,name,category FROM GLAccount WHERE bookId=${bookId} AND id IN (${Prisma.join(selected)})`) : [];
    type AccountSum = { accountId: string; net: bigint; manualNet: bigint; count: bigint; manualCount: bigint };
    const totals = selected.length ? await db.$queryRaw<AccountSum[]>(Prisma.sql`SELECT l.accountId,
      SUM(l.debitMinor-l.creditMinor) net,
      SUM(CASE WHEN COALESCE(o.sourceType,j.sourceType)='manual' THEN l.debitMinor-l.creditMinor ELSE 0 END) manualNet,
      COUNT(*) count,SUM(CASE WHEN COALESCE(o.sourceType,j.sourceType)='manual' THEN 1 ELSE 0 END) manualCount
      FROM GLLine l JOIN GLJournal j ON j.id=l.journalId
      LEFT JOIN GLJournal o ON o.id=j.reversesId AND o.bookId=j.bookId
      WHERE j.bookId=${bookId} AND j.status='posted' AND l.accountId IN (${Prisma.join(selected)}) GROUP BY l.accountId`) : [];
    const rows = (Object.keys(RECON_ROLES) as ReconRole[]).map(role => {
      const ids = rule?.accounts[role] ?? [], raw = business.rows.filter(b => b.role === role), missing = new Set<string>();
      let expected = BigInt(0);
      const originals = raw.map(r => {
        const rate = r.currency === book.baseCurrency ? "1" : rule?.rates.find(item => item.currency === r.currency)?.rate;
        let converted: bigint | null = BigInt(0);
        if (r.amount !== BigInt(0)) {
          if (!rate) { missing.add(r.currency); converted = null; }
          else converted = comparisonAmount(r.amount, r.currency, book.baseCurrency, rate);
        }
        if (converted !== null) expected += converted;
        return { currency: r.currency, amount: formatMoney(r.amount, r.currency), count: r.count, rate: rate ?? null, converted: converted === null ? null : formatMoney(converted, book.baseCurrency) };
      });
      const sums = totals.filter(t => ids.includes(t.accountId)), sign = role === "payable" ? BigInt(-1) : BigInt(1);
      const manualNet = sums.reduce((sum, t) => sum + t.manualNet, BigInt(0)) * sign;
      const actual = sums.reduce((sum, t) => sum + t.net - (role === "funds" ? t.manualNet : BigInt(0)), BigInt(0)) * sign;
      const manualCount = sums.reduce((sum, t) => sum + Number(t.manualCount), 0);
      const difference = missing.size ? null : actual - expected;
      const mappingValid = ids.length > 0 && ids.every(id => accounts.some(a => a.id === id && a.category === (role === "payable" ? "liability" : role === "cost" ? "expense" : "asset")));
      let status: keyof typeof BALANCE_STATES = !mappingValid ? "unmapped" : missing.size ? "needs_rate" :
        role === "cost" && (business.unvalued || business.unassigned) ? "incomplete" : issues.size ? "incomplete" :
        difference !== BigInt(0) ? "difference" : !raw.some(r => r.count > 0) && !sums.some(t => Number(t.count) > 0) ? "empty" :
        sources.pendingCount || sources.orphanCount ? "pending_source" : manualCount ? "manual_review" : "matched";
      if (!rule) status = "unmapped";
      return { role, label: RECON_ROLES[role], status, originals, missingRates: [...missing], accounts: accounts.filter(a => ids.includes(a.id)).map(a => ({ id: a.id, label: a.code + " · " + a.name })),
        business: missing.size ? null : formatMoney(expected, book.baseCurrency), knownBusiness: formatMoney(expected, book.baseCurrency),
        actual: mappingValid ? formatMoney(actual, book.baseCurrency) : null, difference: mappingValid && difference !== null ? formatMoney(difference, book.baseCurrency) : null,
        manualCount, manualAmount: formatMoney(manualNet, book.baseCurrency),
        note: role === "funds" ? "只比已登记资金净变动；总账手工资金分录另列，未核对期初或外部银行余额。" : role === "cost" ? "全部已归单、已计价业务成本与选定成本科目净额比较；未覆盖正式成本结转口径。" : "公司往来总额与选定科目净额比较；含期初或其他手工分录，尚未逐往来辅助账核对。" };
    });
    const q = (filter.q ?? "").trim().slice(0, 100).toLowerCase(), page = resourcePage(filter.page);
    const filtered = sources.rows.filter(s => (!q || (s.label + " " + (s.orderNo ?? "") + " " + s.id).toLowerCase().includes(q)) &&
      (!filter.state || (filter.state === "pending" ? !["matched", "unconfirmed", "inactive"].includes(s.status) : s.status === filter.state)));
    return { book, rule, rows, generatedAt: new Date().toISOString(), scope: "本组织全部已登记业务 / 本账簿全部已过账记录",
      gaps: { unvalued: business.unvalued, unassigned: business.unassigned, changedSources: issues.size, pendingSources: sources.pendingCount, orphanJournals: sources.orphanCount },
      sourceReport: { counts: sources.counts, total: filtered.length, allCount: sources.rows.length, page, pageCount: Math.max(1, Math.ceil(filtered.length / 20)), rows: filtered.slice((page - 1) * 20, page * 20) } };
  }, { timeout: 30000, maxWait: 5000 });
}

export async function getReconciliationLines(actor: TradeActor, bookId: string, role: string, pageInput?: string) {
  await requireReconciliation(actor);
  if (!Object.hasOwn(RECON_ROLES, role)) throw new TradeError("核对项目无效");
  const book = await ledgerBook(prisma, actor.organizationId, bookId), rule = await readReconciliationRule(prisma, actor.organizationId, bookId), ids = rule?.accounts[role as ReconRole] ?? [];
  if (!ids.length) return { book, rows: [], total: 0, page: 1, pageCount: 1 };
  const page = resourcePage(pageInput), where = Prisma.sql`FROM GLLine l JOIN GLJournal j ON j.id=l.journalId
    LEFT JOIN GLJournal o ON o.id=j.reversesId AND o.bookId=j.bookId WHERE j.bookId=${bookId} AND j.status='posted' AND l.accountId IN (${Prisma.join(ids)})`;
  const [count, lines] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n ${where}`),
    prisma.$queryRaw<Array<{ id: string; number: string; date: string; summary: string; accountCode: string; accountName: string; debitMinor: bigint; creditMinor: bigint; sourceType: string }>>(Prisma.sql`SELECT j.id,j.number,j.date,j.summary,l.accountCode,l.accountName,l.debitMinor,l.creditMinor,COALESCE(o.sourceType,j.sourceType) sourceType ${where} ORDER BY j.date DESC,j.number DESC,l.lineNo LIMIT 20 OFFSET ${(page - 1) * 20}`),
  ]);
  return { book, page, total: Number(count[0].n), pageCount: Math.max(1, Math.ceil(Number(count[0].n) / 20)), rows: lines.map(l => ({
    id: l.id, number: l.number, date: l.date, summary: l.summary, account: l.accountCode + " · " + l.accountName, debit: formatMoney(l.debitMinor, book.baseCurrency), credit: formatMoney(l.creditMinor, book.baseCurrency), manual: l.sourceType === "manual", excluded: role === "funds" && l.sourceType === "manual",
  })) };
}
