import { Prisma } from "@prisma/client";
import { expectedSourceAmount } from "@/lib/reconciliation-money";
import { formatMoney, TradeError } from "@/lib/trade-money";
import { ledgerSourceIndex } from "./ledger-source-index";
import type { TradeDb } from "./trade-db";
import type { BookRow } from "./ledger-db";
export const SOURCE_MONEY_STATES = { matched: "来源金额一致", difference: "金额有差异", pending: "尚未过账", reversed: "已冲销待核对", source_changed: "业务来源变化", invalid: "折算依据待核对", reversing: "冲销处理中", unconfirmed: "业务待确认", inactive: "来源失效" };
type Source = { type: string; id: string; label: string; currency: string; amountMinor: bigint; orderId: string | null; orderNo: string | null; businessStatus: string; facts: string; state: string; issue: string | null; journalId: string | null; journalNumber: string | null; journalStatus: string | null; reversedById: string | null; sourceJson: string | null; expectedTotalMinor: bigint | null; debit: bigint; credit: bigint };
export async function readSourceComparisons(db: TradeDb, book: BookRow, changedIds: string[]) {
  const cte = ledgerSourceIndex(book.organizationId, book.id, changedIds);
  const rows = await db.$queryRaw<Source[]>(Prisma.sql`${cte}, totals AS(
    SELECT l.journalId,SUM(l.debitMinor) debit,SUM(l.creditMinor) credit FROM GLLine l JOIN GLJournal j ON j.id=l.journalId WHERE j.bookId=${book.id} GROUP BY l.journalId)
    SELECT b.*,j.sourceJson,j.expectedTotalMinor,COALESCE(t.debit,0) debit,COALESCE(t.credit,0) credit
    FROM bridge b LEFT JOIN GLJournal j ON j.id=b.journalId AND j.bookId=${book.id} LEFT JOIN totals t ON t.journalId=j.id ORDER BY b.occurredOn DESC,b.type,b.id LIMIT 5001`);
  if (rows.length > 5000) throw new TradeError("金额核对超过5000条业务来源，未返回截断结论");
  const [orphan] = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`${cte} SELECT COUNT(*) n FROM GLJournal j
    WHERE j.bookId=${book.id} AND j.status='posted' AND j.sourceType NOT IN ('manual','reversal')
    AND NOT EXISTS(SELECT 1 FROM sources s WHERE s.type=j.sourceType AND s.id=j.sourceId)`);
  const counts = Object.fromEntries(Object.keys(SOURCE_MONEY_STATES).map(key => [key, 0])) as Record<keyof typeof SOURCE_MONEY_STATES, number>;
  const output = rows.map(row => {
    let status: keyof typeof SOURCE_MONEY_STATES = "pending", expected: bigint | null = null, frozen: bigint | null = null, difference: bigint | null = null, issue = row.issue;
    const actual = row.journalStatus === "posted" && !row.reversedById ? row.debit : BigInt(0);
    const actualCredit = row.journalStatus === "posted" && !row.reversedById ? row.credit : BigInt(0);
    if (row.businessStatus === "draft") status = "unconfirmed";
    else if (!["confirmed", "recorded"].includes(row.businessStatus)) status = "inactive";
    else {
      if (row.sourceJson) {
        try {
          const snapshot = JSON.parse(row.sourceJson) as { facts: Record<string, unknown>; rate: string; carryingAmount: string };
          frozen = expectedSourceAmount(snapshot.facts, book.baseCurrency, snapshot.rate, snapshot.carryingAmount);
          expected = expectedSourceAmount(JSON.parse(row.facts), book.baseCurrency, snapshot.rate, snapshot.carryingAmount);
          difference = actual - expected;
          if (row.expectedTotalMinor === null || row.expectedTotalMinor !== frozen) { status = "invalid"; issue = "凭证留存总额与折算依据复算结果不一致"; }
          else if (row.state === "changed") status = "source_changed";
          else if (row.reversedById) status = "reversed";
          else if (row.state === "reversing") status = "reversing";
          else if (row.journalStatus !== "posted") status = "pending";
          else status = difference !== BigInt(0) || actualCredit !== expected ? "difference" : "matched";
        } catch (error) { status = "invalid"; issue = error instanceof TradeError ? error.message : "凭证折算依据无法复算"; }
      } else if (row.state === "changed") status = "source_changed";
    }
    counts[status]++;
    return { type: row.type, id: row.id, label: row.label, orderId: row.orderId, orderNo: row.orderNo, currency: row.currency, amount: formatMoney(row.amountMinor, row.currency),
      journalId: row.journalId, number: row.journalNumber, status, issue,
      expected: expected === null ? null : formatMoney(expected, book.baseCurrency), frozen: frozen === null ? null : formatMoney(frozen, book.baseCurrency),
      actual: formatMoney(actual, book.baseCurrency), actualCredit: formatMoney(actualCredit, book.baseCurrency), difference: difference === null ? null : formatMoney(difference, book.baseCurrency) };
  });
  const pendingCount = Object.entries(counts).filter(([key]) => !["matched", "unconfirmed", "inactive"].includes(key)).reduce((sum, [, n]) => sum + n, 0);
  return { rows: output, counts, pendingCount, orphanCount: Number(orphan.n) };
}
