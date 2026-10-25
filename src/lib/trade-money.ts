import Decimal from "decimal.js";

export const CURRENCIES = { CNY: 2, USD: 2, EUR: 2, GBP: 2, HKD: 2, JPY: 0, AUD: 2, CAD: 2, SGD: 2, CHF: 2, KWD: 3 } as const;
export type Currency = keyof typeof CURRENCIES;
export const MAX_MINOR = BigInt("999999999999999");
const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export class TradeError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "TradeError"; }
}
export function currencyDigits(currency: string) {
  if (!Object.hasOwn(CURRENCIES, currency)) throw new TradeError("暂不支持该币种，请选择列表中的币种");
  return CURRENCIES[currency as Currency];
}
export function parseMoney(value: string, currency: string, options: { zero?: boolean; signed?: boolean } = {}) {
  const digits = currencyDigits(currency), text = value.trim();
  const pattern = new RegExp(`^${options.signed ? "-?" : ""}\\d{1,15}${digits ? `(\\.\\d{1,${digits}})?` : ""}$`);
  if (!pattern.test(text)) throw new TradeError(`金额须为${currency}有效数字，最多${digits}位小数`);
  const amount = BigInt(new MoneyDecimal(text).mul(new MoneyDecimal(10).pow(digits)).toFixed(0));
  if ((!options.zero && amount === BigInt(0)) || (!options.signed && amount < BigInt(0)) || amount > MAX_MINOR || amount < -MAX_MINOR) throw new TradeError("金额须在允许范围内且大于零，扣补金额可以为负数");
  return amount;
}
export function formatMoney(value: bigint | string, currency: string) {
  const digits = currencyDigits(currency);
  return new MoneyDecimal(value.toString()).div(new MoneyDecimal(10).pow(digits)).toFixed(digits);
}
export function normalizeRate(value: string) {
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(value.trim()) || new MoneyDecimal(value).lte(0)) throw new TradeError("汇率须为正数，整数与小数各最多8位");
  return new MoneyDecimal(value).toFixed();
}
export function convertMoney(amount: bigint, from: string, to: string, rate: string) {
  const converted = new MoneyDecimal(formatMoney(amount, from)).mul(normalizeRate(rate)).mul(new MoneyDecimal(10).pow(currencyDigits(to))).toDecimalPlaces(0);
  const minor = BigInt(converted.toFixed(0));
  if (minor <= BigInt(0) || minor > MAX_MINOR) throw new TradeError("折算金额过小或超出允许范围");
  return minor;
}
export function checkDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "1900-01-01" || value > "2199-12-31") throw new TradeError("日期须在1900至2199年之间");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new TradeError("日期无效");
  return value;
}
export function dateInZone(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
