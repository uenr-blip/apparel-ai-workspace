import { ensureCashCanVoid } from "./treasury-write";
import { createId } from "@/lib/hash";
import { checkDate, convertMoney, dateInZone, MAX_MINOR, normalizeRate, parseMoney, TradeError } from "@/lib/trade-money";
import { billRow, cashRow, requireVersion, tradeParty, type TradeDb } from "./trade-db";
import type { TradeActor, TradeCommand } from "./trade-contract";

export async function writeTradeSettlement(db: TradeDb, actor: TradeActor, command: TradeCommand, now: string): Promise<{ id: string; summary: string }> {
  const org = actor.organizationId;
  const organization = await db.organization.findUniqueOrThrow({ where: { id: org }, select: { timezone: true } });
  const today = dateInZone(new Date(now), organization.timezone);
  if (command.action === "record_cash") {
    const partyKind = command.direction === "receive" ? "customer" : "party";
    const party = await tradeParty(db, org, partyKind, command.partyId);
    const amount = parseMoney(command.amount, command.currency), fee = parseMoney(command.fee, command.currency, { zero: true });
    if ((command.direction === "receive" && fee >= amount) || amount + fee > MAX_MINOR) throw new TradeError("手续费不能覆盖全部收款本金或导致金额超限");
    const occurredOn = checkDate(command.occurredOn);
    if (occurredOn > today) throw new TradeError("已发生流水不能登记未来日期；付款安排请使用应付到期日");
    const duplicate = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM TradeCash WHERE organizationId=${org} AND bankAccount=${command.bankAccount} AND bankReference=${command.bankReference} AND direction=${command.direction} AND status='recorded' LIMIT 1`;
    if (duplicate.length) throw new TradeError("该账户的同一银行流水号已经登记，请先查阅原记录");
    let baseAmount: bigint | null = null, rate: string | null = null, rateDate: string | null = null;
    if (command.baseCurrency) {
      if (!command.exchangeRate || !command.rateSource || !command.rateDate) throw new TradeError("折算须填写汇率、日期和来源");
      rate = normalizeRate(command.exchangeRate); rateDate = checkDate(command.rateDate);
      if (rateDate > today) throw new TradeError("参考汇率日期不能晚于今天");
      if (command.baseCurrency === command.currency && rate !== "1") throw new TradeError("同币种折算汇率必须为1");
      baseAmount = convertMoney(amount, command.currency, command.baseCurrency, rate);
    } else if (command.exchangeRate || command.rateDate || command.rateSource) throw new TradeError("请同时选择折算币种，或清空折算信息");
    const id = createId();
    await db.$executeRaw`INSERT INTO TradeCash(id,organizationId,direction,partyKind,partyId,currency,amountMinor,feeMinor,bankAccount,bankReference,occurredOn,basis,baseCurrency,baseAmountMinor,exchangeRate,rateDate,rateSource,status,version,createdBy,createdAt)
      VALUES(${id},${org},${command.direction},${partyKind},${command.partyId},${command.currency},${amount},${fee},${command.bankAccount},${command.bankReference},${occurredOn},${command.basis},${command.baseCurrency || null},${baseAmount},${rate},${rateDate},${command.rateSource || null},'recorded',1,${actor.userId},${now})`;
    return { id, summary: `登记${party.name}已发生${command.direction === "receive" ? "收款" : "付款"} ${command.currency} ${command.amount}，未发起银行操作` };
  }
  if (command.action === "void_cash") {
    const cash = await cashRow(db, org, command.id); requireVersion(cash.version, command.expectedVersion);
    await ensureCashCanVoid(db,org,cash.id);
    if (cash.status !== "recorded") throw new TradeError("流水已作废");
    if (cash.allocatedMinor > BigInt(0)) throw new TradeError("流水仍有核销分配，请先撤回核销");
    await db.$executeRaw`UPDATE TradeCash SET status='void',voidReason=${command.reason},version=version+1 WHERE id=${cash.id} AND organizationId=${org}`;
    return { id: cash.id, summary: `作废流水登记 ${cash.bankReference}：${command.reason}；不撤销银行交易` };
  }
  if (command.action === "allocate") {
    const bill = await billRow(db, org, command.billId), cash = await cashRow(db, org, command.cashId);
    requireVersion(bill.version, command.expectedBillVersion); requireVersion(cash.version, command.expectedCashVersion);
    if (bill.status !== "confirmed" || cash.status !== "recorded") throw new TradeError("仅已确认单据和有效流水可核销");
    if (bill.partyKind !== cash.partyKind || bill.partyId !== cash.partyId || (bill.direction === "receivable" ? "receive" : "pay") !== cash.direction) throw new TradeError("核销须匹配同一往来方及收付方向");
    const cashAmount = parseMoney(command.cashAmount, cash.currency);
    let rate = "1", date = cash.occurredOn, source = "同币种核销";
    if (bill.currency !== cash.currency) {
      if (!command.exchangeRate || !command.rateDate || !command.rateSource) throw new TradeError("跨币种核销须提供汇率、日期和来源");
      rate = normalizeRate(command.exchangeRate); date = checkDate(command.rateDate); source = command.rateSource;
      if (date > today) throw new TradeError("核销汇率日期不能晚于今天");
    } else if (command.exchangeRate && normalizeRate(command.exchangeRate) !== "1") throw new TradeError("同币种不能通过汇率改变核销金额");
    const billAmount = convertMoney(cashAmount, cash.currency, bill.currency, rate);
    if (cashAmount > cash.availableMinor || billAmount > bill.openMinor) throw new TradeError("核销金额超过流水可分配额或单据余额，请刷新核对", 409);
    const id = createId();
    await db.$executeRaw`INSERT INTO TradeAllocation(id,organizationId,billId,cashId,billAmountMinor,cashAmountMinor,exchangeRate,rateDate,rateSource,status,createdBy,createdAt)
      VALUES(${id},${org},${bill.id},${cash.id},${billAmount},${cashAmount},${rate},${date},${source},'active',${actor.userId},${now})`;
    await db.$executeRaw`UPDATE TradeBill SET version=version+1 WHERE id=${bill.id} AND organizationId=${org}`;
    await db.$executeRaw`UPDATE TradeCash SET version=version+1 WHERE id=${cash.id} AND organizationId=${org}`;
    return { id, summary: `${bill.orderNo} ${bill.title} 核销流水 ${cash.bankReference}，保留双币金额及汇率依据` };
  }
  if (command.action === "reverse_allocation") {
    const [allocation] = await db.$queryRaw<Array<{ id: string; billId: string; cashId: string; status: string }>>`SELECT id,billId,cashId,status FROM TradeAllocation WHERE organizationId=${org} AND id=${command.id}`;
    if (!allocation || allocation.status !== "active") throw new TradeError("核销不存在或已经撤回");
    await billRow(db, org, allocation.billId); await cashRow(db, org, allocation.cashId);
    await db.$executeRaw`UPDATE TradeAllocation SET status='reversed',reversedBy=${actor.userId},reversedAt=${now},reversalReason=${command.reason} WHERE id=${allocation.id} AND organizationId=${org}`;
    await db.$executeRaw`UPDATE TradeBill SET version=version+1 WHERE id=${allocation.billId} AND organizationId=${org}`;
    await db.$executeRaw`UPDATE TradeCash SET version=version+1 WHERE id=${allocation.cashId} AND organizationId=${org}`;
    return { id: allocation.id, summary: `撤回核销分配：${command.reason}；原记录保留` };
  }
  throw new TradeError("不支持的资金动作");
}
