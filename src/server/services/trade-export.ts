import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { csvCell, formatMoney, TradeError } from "@/lib/trade-money";
import { billCte, cashCte, requireTrade, type BillRow, type CashRow } from "./trade-db";
import { billWhere, cashWhere, tradeToday, type TradeFilter } from "./trade-read";
import { writeAudit } from "./intake";
import type { TradeActor } from "./trade-contract";

export async function exportTrade(actor: TradeActor, kind: string, filter: TradeFilter) {
  await requireTrade(actor, "trade_export");
  const org = actor.organizationId, today = await tradeToday(actor);
  let lines: unknown[][];
  if (kind === "bills") {
    const rows = await prisma.$queryRaw<BillRow[]>(Prisma.sql`${billCte(org)} SELECT * FROM bills WHERE ${billWhere(filter, today)} ORDER BY dueDate,id LIMIT 5001`);
    if (rows.length > 5000) throw new TradeError("超过5000条，请按日期或币种缩小导出范围");
    lines = [["业务单据ID", "业务来源", "方向", "往来方", "款项", "币种", "原金额", "扣补", "单据金额", "已核销", "未核销", "到期日", "状态", "依据", "费用发生日", "费用凭据号"],
      ...rows.map(row => [row.id, row.orderNo, row.direction, row.partyName, row.title, row.currency, formatMoney(row.amountMinor, row.currency), formatMoney(row.adjustmentMinor, row.currency), formatMoney(row.totalMinor, row.currency), formatMoney(row.allocatedMinor, row.currency), formatMoney(row.openMinor, row.currency), row.dueDate, row.status, row.basis, row.expenseDate ?? "", row.expenseReference ?? ""])];
  } else if (kind === "cash") {
    const rows = await prisma.$queryRaw<CashRow[]>(Prisma.sql`${cashCte(org)} SELECT * FROM cash WHERE ${cashWhere(filter)} ORDER BY occurredOn,id LIMIT 5001`);
    if (rows.length > 5000) throw new TradeError("超过5000条，请按日期或币种缩小导出范围");
    lines = [["流水ID", "方向", "往来方", "币种", "本金", "手续费", "银行净变动", "已分配", "未分配", "账户名称", "银行流水号", "发生日", "状态", "折算币种", "折算本金", "汇率", "汇率日期", "汇率来源", "依据"],
      ...rows.map(row => [row.id, row.direction, row.partyName, row.currency, formatMoney(row.amountMinor, row.currency), formatMoney(row.feeMinor, row.currency), formatMoney(row.direction === "receive" ? row.amountMinor - row.feeMinor : row.amountMinor + row.feeMinor, row.currency), formatMoney(row.allocatedMinor, row.currency), formatMoney(row.availableMinor, row.currency), row.bankAccount, row.bankReference, row.occurredOn, row.status, row.baseCurrency, row.baseCurrency && row.baseAmountMinor !== null ? formatMoney(row.baseAmountMinor, row.baseCurrency) : "", row.exchangeRate, row.rateDate, row.rateSource, row.basis])];
  } else throw new TradeError("不支持的导出类型");
  // Repeat the live permission check immediately before returning sensitive records.
  await requireTrade(actor, "trade_export");
  await writeAudit({ organizationId: org, actorUserId: actor.userId, action: "trade.export", entityType: "TradeLedger", entityId: kind, summary: `导出${kind === "bills" ? "应收应付" : "收付流水"}业务台账 ${lines.length - 1}条`, payloadJson: JSON.stringify({ kind, filter, count: lines.length - 1 }) });
  return { filename: `yiju-trade-${kind}-${today}.csv`, csv: "\uFEFF" + lines.map(row => row.map(csvCell).join(",")).join("\r\n") };
}
