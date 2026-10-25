import { currencyDigits, MAX_MINOR, TradeError } from "./trade-money";
export function quantityMilli(raw: string) {
  if (!/^\d{1,10}(\.\d{1,3})?$/.test(raw.trim())) throw new TradeError("数量须为正数，最多3位小数");
  const [whole, part=""] = raw.trim().split(".");
  const n=BigInt(whole)*BigInt(1000)+BigInt(part.padEnd(3,"0"));
  if(n<=BigInt(0)||n>BigInt("2147483647000")) throw new TradeError("数量超出允许范围");
  return n;
}
export function quantityText(n: bigint) { return `${n/BigInt(1000)}.${(n%BigInt(1000)).toString().padStart(3,"0")}`.replace(/\.?0+$/, ""); }
export function priceMicros(raw: string) {
  if (!/^\d{1,9}(\.\d{1,6})?$/.test(raw.trim())) throw new TradeError("单价须为正数，最多6位小数");
  const [whole,part=""]=raw.trim().split("."); const n=BigInt(whole)*BigInt(1000000)+BigInt(part.padEnd(6,"0"));
  if(n<=BigInt(0)) throw new TradeError("单价必须大于零"); return n;
}
export function priceText(n: bigint) { return `${n/BigInt(1000000)}.${(n%BigInt(1000000)).toString().padStart(6,"0")}`.replace(/\.?0+$/, ""); }
export function materialAmount(qty: bigint, price: bigint, currency: string) {
  const denominator=BigInt(1000000000), numerator=qty*price*BigInt(10)**BigInt(currencyDigits(currency));
  const value=(numerator+denominator/BigInt(2))/denominator;
  if(value>MAX_MINOR) throw new TradeError("材料金额超出允许范围");return value;
}
export const MATERIAL_MOVEMENT_LABELS:Record<string,string>={receive:"实际收料",transfer:"调拨",consume:"领用",return_supplier:"退供",return_unused:"未耗用退回",reverse_use:"领用冲销",reverse_supplier_return:"退供冲销",reverse_unused_return:"退回冲销",reverse_transfer:"调拨冲销",reverse_receipt:"收料冲销"};
