import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export function d(value: string | number | Decimal) {
  return new Decimal(value);
}

export function moneyMinorFromYuan(value: string | number | Decimal) {
  return d(value).mul(100).toDecimalPlaces(0).toNumber();
}

export function yuanFromMinor(minor: number) {
  return d(minor).div(100).toFixed(2);
}

export type GrossRequirementInput = {
  quantityPieces: number;
  consumption: string;
  allowanceRate: string;
  includesAllowance: boolean;
};

export function grossRequirementMeters(input: GrossRequirementInput) {
  const base = d(input.quantityPieces).mul(input.consumption);
  const gross = input.includesAllowance ? base : base.mul(d(1).plus(input.allowanceRate));
  return gross.toDecimalPlaces(0).toFixed(0);
}

export function netRequirementMeters(input: {
  gross: string;
  eligibleFreeStock: string;
  eligibleTimelyInbound: string;
}) {
  const net = Decimal.max(0, d(input.gross).minus(input.eligibleFreeStock).minus(input.eligibleTimelyInbound));
  return net.toFixed(0);
}

export function suggestedPurchaseMeters(input: {
  net: string;
  moq: string;
  multiple: string;
}) {
  const net = d(input.net);
  if (net.lte(0)) return "0";
  const multiple = d(input.multiple);
  let suggested = net.div(multiple).ceil().mul(multiple);
  const moq = d(input.moq);
  if (suggested.lt(moq)) {
    suggested = moq.div(multiple).ceil().mul(multiple);
  }
  return suggested.toFixed(0);
}

export function purchaseLineAmountYuan(qty: string, unitPriceYuan: string) {
  return d(qty).mul(unitPriceYuan).toFixed(2);
}

export function purchaseLineAmountMinor(qty: string, unitPriceYuan: string) {
  return moneyMinorFromYuan(purchaseLineAmountYuan(qty, unitPriceYuan));
}
