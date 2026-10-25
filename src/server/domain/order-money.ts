export type OrderMoneyBill = {
  currency: string;
  direction: "receivable" | "payable";
  status: string;
  totalMinor: bigint;
  allocatedMinor: bigint;
  openMinor: bigint;
};

export type OrderMoneyLine = {
  currency: string;
  contractMinor: bigint | null;
  receivableMinor: bigint;
  receivedMinor: bigint;
  receivableOpenMinor: bigint;
  payableMinor: bigint;
  paidMinor: bigint;
  payableOpenMinor: bigint;
};

export type OrderMoney = {
  hasContract: boolean;
  draftReceivableCount: number;
  draftPayableCount: number;
  lines: OrderMoneyLine[];
  label: string;
  facts: string[];
};

function zeroLine(currency: string): OrderMoneyLine {
  return {
    currency,
    contractMinor: null,
    receivableMinor: BigInt(0),
    receivedMinor: BigInt(0),
    receivableOpenMinor: BigInt(0),
    payableMinor: BigInt(0),
    paidMinor: BigInt(0),
    payableOpenMinor: BigInt(0),
  };
}

export function evaluateOrderMoney(input: {
  contract: { currency: string; amountMinor: bigint } | null;
  bills: OrderMoneyBill[];
}): OrderMoney {
  const byCurrency = new Map<string, OrderMoneyLine>();
  const line = (currency: string) => {
    const current = byCurrency.get(currency) ?? zeroLine(currency);
    byCurrency.set(currency, current);
    return current;
  };

  if (input.contract) {
    line(input.contract.currency).contractMinor = input.contract.amountMinor;
  }

  let draftReceivableCount = 0;
  let draftPayableCount = 0;
  for (const bill of input.bills) {
    if (bill.status === "draft") {
      if (bill.direction === "receivable") draftReceivableCount += 1;
      else draftPayableCount += 1;
      continue;
    }
    if (bill.status !== "confirmed") continue;
    const current = line(bill.currency);
    if (bill.direction === "receivable") {
      current.receivableMinor += bill.totalMinor;
      current.receivedMinor += bill.allocatedMinor;
      current.receivableOpenMinor += bill.openMinor;
    } else {
      current.payableMinor += bill.totalMinor;
      current.paidMinor += bill.allocatedMinor;
      current.payableOpenMinor += bill.openMinor;
    }
  }

  const lines = [...byCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
  const receivableOpen = lines.reduce((sum, item) => sum + item.receivableOpenMinor, BigInt(0));
  const payableOpen = lines.reduce((sum, item) => sum + item.payableOpenMinor, BigInt(0));
  const hasConfirmed = lines.some(
    (item) => item.receivableMinor > BigInt(0) || item.payableMinor > BigInt(0),
  );

  let label = "本单还没有登记收付";
  if (input.contract && !hasConfirmed) label = "已登记合同，应收应付尚未确认";
  else if (receivableOpen > BigInt(0) || payableOpen > BigInt(0)) label = "有未结清的已确认款项";
  else if (hasConfirmed) label = "已确认款项已核销完";

  return {
    hasContract: Boolean(input.contract),
    draftReceivableCount,
    draftPayableCount,
    lines,
    label,
    facts: [
      "已收、已付是核销到本单的登记，不是银行执行。",
      "草稿款项不计入还欠。",
      "这里不展示借贷科目。正式采购与真付款未下达。",
      "合同金额不是出运自动生成。",
    ],
  };
}
