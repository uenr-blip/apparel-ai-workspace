import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { checkDate, currencyDigits, dateInZone, normalizeRate, TradeError } from "@/lib/trade-money";
import { financialWrite, ledgerBook, requireLedger } from "./ledger-db";
import { requireTrade, requireVersion, type TradeDb } from "./trade-db";
import type { TradeActor } from "./trade-contract";
export const RECON_ROLES = { receivable: "客户应收余额", payable: "供应商 / 工厂应付余额", funds: "已登记资金净变动", cost: "已知订单成本" };
export type ReconRole = keyof typeof RECON_ROLES;
const ids = z.array(z.string().min(1).max(120)).max(50);
const RuleBody = z.object({
  accounts: z.object({ receivable: ids, payable: ids, funds: ids, cost: ids }),
  rates: z.array(z.object({ currency: z.string().length(3), rate: z.string().min(1).max(32), date: z.string(), basis: z.string().trim().min(1).max(1000) })).max(11),
  basis: z.string().trim().min(1).max(2000),
});
export type ReconciliationRule = z.infer<typeof RuleBody> & { version: number; updatedAt: string; updatedBy: string };
export const RuleCommand = RuleBody.extend({ action: z.literal("save_reconciliation_rule"), bookId: z.string().min(1).max(120), expectedVersion: z.number().int().nonnegative(), idempotencyKey: z.string().min(1).max(120) });
const key = (bookId: string) => `ledger-reconciliation:${bookId}`;
export async function requireReconciliation(actor: TradeActor, db: TradeDb = prisma) { await requireTrade(actor, "trade_view", db); await requireLedger(actor, "ledger_view", db); }
export async function readReconciliationRule(db: TradeDb, org: string, bookId: string) {
  const row = await db.organizationPolicy.findUnique({ where: { organizationId_key: { organizationId: org, key: key(bookId) } } });
  if (!row?.enabled) return null;
  try {
    const raw = JSON.parse(row.valueJson) as ReconciliationRule;
    const parsed = RuleBody.parse(raw);
    if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error("version");
    return { ...parsed, version: raw.version, updatedAt: raw.updatedAt, updatedBy: raw.updatedBy };
  } catch { throw new TradeError("对账口径记录无效，须先核对配置"); }
}
export async function saveReconciliationRule(actor: TradeActor, input: unknown) {
  const parsed = RuleCommand.safeParse(input); if (!parsed.success) throw new TradeError("请补齐对账科目、汇率日期和口径依据");
  const c = parsed.data;
  await requireReconciliation(actor);
  return financialWrite(actor, "ledger", c, "ledger_config", async (db, now) => {
    await requireReconciliation(actor, db);
    const book = await ledgerBook(db, actor.organizationId, c.bookId);
    if (book.mode !== "demo") throw new TradeError("本轮仅配置演示核对口径，不启用正式会计规则");
    const previous = await readReconciliationRule(db, actor.organizationId, book.id); requireVersion(previous?.version ?? 0, c.expectedVersion);
    const allIds = Object.values(c.accounts).flat();
    if (new Set(allIds).size !== allIds.length) throw new TradeError("同一科目不能重复选择或跨核对项目使用");
    const accounts = allIds.length ? await db.$queryRaw<Array<{ id: string; category: string }>>(Prisma.sql`SELECT id,category FROM GLAccount WHERE bookId=${book.id} AND id IN (${Prisma.join(allIds)})`) : [];
    if (accounts.length !== allIds.length) throw new TradeError("科目不存在或不属于当前账簿");
    for (const role of Object.keys(RECON_ROLES) as ReconRole[]) for (const id of c.accounts[role]) {
      const category = role === "payable" ? "liability" : role === "cost" ? "expense" : "asset";
      if (accounts.find(a => a.id === id)?.category !== category) throw new TradeError(`${RECON_ROLES[role]}所选科目类别不匹配`);
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { timezone: true } });
    const seen = new Set<string>();
    for (const r of c.rates) {
      currencyDigits(r.currency); r.rate = normalizeRate(r.rate); checkDate(r.date);
      if (seen.has(r.currency) || r.currency === book.baseCurrency) throw new TradeError("币种重复；本位币无需另配汇率");
      if (r.date > dateInZone(new Date(now), org.timezone)) throw new TradeError("核对汇率日期不能晚于今天");
      seen.add(r.currency);
    }
    const value: ReconciliationRule = { accounts: c.accounts, rates: c.rates, basis: c.basis, version: (previous?.version ?? 0) + 1, updatedBy: actor.userId, updatedAt: now };
    await db.organizationPolicy.upsert({ where: { organizationId_key: { organizationId: actor.organizationId, key: key(book.id) } },
      create: { id: createId(), organizationId: actor.organizationId, key: key(book.id), valueJson: JSON.stringify(value), enabled: true, note: "演示金额核对口径，不改凭证或自动重估" },
      update: { valueJson: JSON.stringify(value), enabled: true, note: "演示金额核对口径，不改凭证或自动重估" } });
    return { id: book.id, summary: `保存金额核对口径第${value.version}版；仅用于比较，未修改任何凭证` };
  });
}
export async function reconciliationAccounts(actor: TradeActor, bookId: string, role: string, q = "") {
  await requireReconciliation(actor); await ledgerBook(prisma, actor.organizationId, bookId);
  if (!Object.hasOwn(RECON_ROLES, role)) throw new TradeError("核对项目无效");
  const category = role === "payable" ? "liability" : role === "cost" ? "expense" : "asset";
  return prisma.$queryRaw<Array<{ id: string; label: string }>>(Prisma.sql`SELECT id,code||' · '||name label FROM GLAccount WHERE bookId=${bookId} AND category=${category}
    ${q.trim() ? Prisma.sql`AND instr(lower(code||' '||name),lower(${q.trim().slice(0, 100)}))>0` : Prisma.empty} ORDER BY code LIMIT 20`);
}
