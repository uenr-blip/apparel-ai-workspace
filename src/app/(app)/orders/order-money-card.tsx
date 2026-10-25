import Link from "next/link";
import { Card } from "@/components/ui/card";
import { SheetHead } from "@/components/ui/sheet";

type OrderMoneyView = Awaited<ReturnType<typeof import("@/server/services/order-money").getOrderMoney>>;

export function OrderMoneyCard({
  money,
  canOpenFinance,
  showCustomer,
}: {
  money: OrderMoneyView;
  canOpenFinance: boolean;
  showCustomer: boolean;
}) {
  return (
    <Card id="order-money" className="desk-square scroll-mt-24">
      <SheetHead
        title="本单收付"
        action={
          canOpenFinance ? (
            <Link href={`/finance/orders/${money.orderId}`} className="text-sm text-[var(--brand-strong)]">
              外贸结算 →
            </Link>
          ) : null
        }
      />
      <p className="mt-3 text-sm leading-6">{money.label}</p>
      {showCustomer && money.contractAmount ? (
        <p className="mt-1 text-sm tabular-nums">
          合同 {money.contractCurrency} {money.contractAmount}
        </p>
      ) : null}
      {money.lines.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {money.lines.map((line) => (
            <li key={line.currency} className="tabular-nums">
              <p>{line.currency}</p>
              {showCustomer ? (
                <p className="text-xs text-[var(--ink-muted)]">
                  已收 {line.received} · 还欠客户 {line.receivableOpen}
                </p>
              ) : null}
              <p className="text-xs text-[var(--ink-muted)]">
                已付 {line.paid} · 还欠供应/厂 {line.payableOpen}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">没有已确认的本单款项。不能把空当成已结清。</p>
      )}
      {money.draftReceivableCount || money.draftPayableCount ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          还有草稿应收 {money.draftReceivableCount}、草稿应付 {money.draftPayableCount}，未计入还欠。
        </p>
      ) : null}
      {money.reconDrafts.length ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          加工对账草稿 {money.reconDrafts[0]!.amountYuan ?? "金额待核实"} · {money.reconDrafts[0]!.status}。对账草稿不是付款。
        </p>
      ) : null}
    </Card>
  );
}
