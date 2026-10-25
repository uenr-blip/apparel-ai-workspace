import Decimal from "decimal.js";
import { currencyDigits, formatMoney, normalizeRate, parseMoney, TradeError } from "./trade-money";
const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
const zero = BigInt(0);
export function comparisonAmount(amount: bigint, from: string, to: string, rate: string): bigint {
  const normalized = from === to ? "1" : normalizeRate(rate);
  return BigInt(new D(formatMoney(amount, from)).mul(normalized).mul(new D(10).pow(currencyDigits(to))).toFixed(0));
}
function minor(value: unknown) {
  if (typeof value !== "string" || !/^-?\d{1,30}$/.test(value)) throw new TradeError("来源金额依据缺失或无效");
  return BigInt(value);
}
export function expectedSourceAmount(facts: Record<string, unknown>, baseCurrency: string, rate: string, carrying: string): bigint {
  if (facts.type === "fx") {
    if (facts.toCurrency !== baseCurrency) throw new TradeError("换汇买入币种不是账簿本位币，需另行核对");
    const gross = minor(facts.toMinor), fee = minor(facts.feeMinor), bookValue = parseMoney(carrying, baseCurrency);
    if (fee < zero || fee >= gross) throw new TradeError("换汇费用依据无效");
    return gross > bookValue ? gross : bookValue;
  }
  if (typeof facts.currency !== "string") throw new TradeError("缺少原币币种");
  const adjustment = facts.adjustment as { amount?: unknown } | null;
  const principal = minor(facts.type === "adjustment" ? adjustment?.amount : facts.type === "bill" ? facts.originalAmount : facts.amount);
  const amount = comparisonAmount(principal < zero ? -principal : principal, facts.currency, baseCurrency, rate);
  const fee = ["cash", "refund"].includes(String(facts.type)) ? comparisonAmount(minor(facts.fee), facts.currency, baseCurrency, rate) : zero;
  if (fee < zero || amount <= zero || (facts.direction === "receive" && fee >= amount)) throw new TradeError("来源本金或费用无法形成有效分录");
  return amount + (facts.direction === "pay" ? fee : zero);
}
