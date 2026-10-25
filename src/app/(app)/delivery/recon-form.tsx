import Link from "next/link";
import type { ProductionBoardRow } from "@/server/services/production-board";
export function ReconDraftForm({ orders }: { orders: ProductionBoardRow[] }) {
  const visible = orders.filter(order => order.canRecon || order.recon);
  if (!visible.length) return null;
  return <div className="space-y-3 text-sm">
    <p>在财务核对视图确认本单加工单价与出运依据，生成或更新对账草稿。</p>
    {visible.map(order => <div key={order.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] p-3">
      <span>{order.orderNo} · 已发 {order.shipped} 件{order.recon?.amountYuan ? ` · 草稿 ${order.recon.amountYuan} 元` : ""}</span>
      <Link href={`/finance?tab=reconciliation&q=${encodeURIComponent(order.orderNo)}`} className="text-[var(--brand-strong)]">去财务核对</Link>
    </div>)}
  </div>;
}
