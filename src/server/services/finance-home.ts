import { prisma } from "@/lib/db";
import { TradeError } from "@/lib/trade-money";
import { tradePermissions, cashCte } from "./trade-db";
import { ledgerPermissions } from "./ledger-db";
import { canUserAction } from "./user-permissions";
import { getTradeOverview } from "./trade-read";
import { getFinanceOverview } from "./finance-board";
import type { TradeActor } from "./trade-contract";
import { Prisma } from "@prisma/client";

export async function getFinanceHome(actor: TradeActor) {
  const user = await prisma.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, role: actor.role, active: true } });
  if (!user || !["manager", "salesperson"].includes(user.role)) throw new TradeError("无权查阅财务工作台", 403);
  const [tradeGrants, ledgerGrants, legacyAccess] = await Promise.all([tradePermissions(actor), ledgerPermissions(actor), canUserAction(actor, "generate_factory_recon")]);
  const capabilities = { trade: tradeGrants.has("trade_view"), ledger: ledgerGrants.has("ledger_view"), legacy: legacyAccess };
  if (!Object.values(capabilities).some(Boolean)) throw new TradeError("无权查阅财务工作台，请经理下发权限", 403);
  const [trade, legacy, cash, ledger] = await Promise.all([
    capabilities.trade ? getTradeOverview(actor) : null,
    capabilities.legacy ? getFinanceOverview(actor) : null,
    capabilities.trade ? prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`${cashCte(actor.organizationId)} SELECT COUNT(*) n FROM cash WHERE status='recorded' AND availableMinor>0`) : null,
    capabilities.ledger ? ledgerTasks(actor) : null,
  ]);
  return { capabilities, trade, legacy, unallocatedCashCount: cash ? Number(cash[0].n) : null, ledger, tradeGrants, ledgerGrants };
}

async function ledgerTasks(actor: TradeActor) {
  const org = actor.organizationId;
  const [summary, books] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ bookCount: bigint; drafts: bigint; reviewable: bigint; toPost: bigint }>>`SELECT
      (SELECT COUNT(*) FROM GLBook WHERE organizationId=${org}) bookCount,
      COALESCE(SUM(CASE WHEN j.status='draft' THEN 1 ELSE 0 END),0) drafts,
      COALESCE(SUM(CASE WHEN j.status='draft' AND j.createdBy<>${actor.userId} THEN 1 ELSE 0 END),0) reviewable,
      COALESCE(SUM(CASE WHEN j.status='reviewed' THEN 1 ELSE 0 END),0) toPost
      FROM GLJournal j JOIN GLBook b ON b.id=j.bookId WHERE b.organizationId=${org}`,
    prisma.$queryRaw<Array<{ id: string; name: string; baseCurrency: string; drafts: bigint; reviewed: bigint }>>`SELECT b.id,b.name,b.baseCurrency,
      COALESCE(SUM(CASE WHEN j.status='draft' THEN 1 ELSE 0 END),0) drafts,
      COALESCE(SUM(CASE WHEN j.status='reviewed' THEN 1 ELSE 0 END),0) reviewed
      FROM GLBook b LEFT JOIN GLJournal j ON j.bookId=b.id WHERE b.organizationId=${org}
      GROUP BY b.id ORDER BY reviewed DESC,drafts DESC,b.createdAt DESC,b.id LIMIT 6`,
  ]);
  return { bookCount: Number(summary[0].bookCount), drafts: Number(summary[0].drafts), reviewable: Number(summary[0].reviewable), toPost: Number(summary[0].toPost),
    books: books.map(b => ({ ...b, drafts: Number(b.drafts), reviewed: Number(b.reviewed) })) };
}
