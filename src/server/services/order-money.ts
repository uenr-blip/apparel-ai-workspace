import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/trade-money";
import { evaluateOrderMoney } from "@/server/domain/order-money";
import { billCte, getContractRow, type BillRow } from "@/server/services/trade-db";

function asMinor(value: bigint | number | string) {
  return BigInt(value);
}

export async function getOrderMoney(organizationId: string, orderId: string) {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    select: { id: true, orderNo: true },
  });
  if (!order) throw new Error("订单不存在或不属于当前组织");

  const [contract, bills, reconDrafts] = await Promise.all([
    getContractRow(prisma, organizationId, orderId),
    prisma.$queryRaw<BillRow[]>(Prisma.sql`${billCte(organizationId)} SELECT * FROM bills WHERE orderId=${orderId}`),
    prisma.factoryReconDraft.findMany({
      where: { organizationId, orderId },
      select: { id: true, status: true, amountYuan: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const money = evaluateOrderMoney({
    contract: contract
      ? { currency: contract.currency, amountMinor: asMinor(contract.amountMinor) }
      : null,
    bills: bills.map((bill) => ({
      currency: bill.currency,
      direction: bill.direction,
      status: bill.status,
      totalMinor: asMinor(bill.totalMinor),
      allocatedMinor: asMinor(bill.allocatedMinor),
      openMinor: asMinor(bill.openMinor),
    })),
  });

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    hasContract: money.hasContract,
    contractCurrency: contract?.currency ?? null,
    contractAmount: contract ? formatMoney(asMinor(contract.amountMinor), contract.currency) : null,
    draftReceivableCount: money.draftReceivableCount,
    draftPayableCount: money.draftPayableCount,
    label: money.label,
    facts: money.facts,
    reconDrafts: reconDrafts.map((row) => ({
      id: row.id,
      status: row.status,
      amountYuan: row.amountYuan,
    })),
    lines: money.lines.map((line) => ({
      currency: line.currency,
      contract: line.contractMinor === null ? null : formatMoney(line.contractMinor, line.currency),
      receivable: formatMoney(line.receivableMinor, line.currency),
      received: formatMoney(line.receivedMinor, line.currency),
      receivableOpen: formatMoney(line.receivableOpenMinor, line.currency),
      payable: formatMoney(line.payableMinor, line.currency),
      paid: formatMoney(line.paidMinor, line.currency),
      payableOpen: formatMoney(line.payableOpenMinor, line.currency),
    })),
  };
}
