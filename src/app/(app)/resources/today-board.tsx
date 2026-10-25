import Link from "next/link";
import { Badge, Card } from "@/components/ui/card";
import { getTodayWarehouse } from "@/server/services/today-warehouse";

export async function TodayWarehouseBoard({
  organizationId,
  role,
  factoryId,
}: {
  organizationId: string;
  role: string;
  factoryId: string | null;
}) {
  const today = await getTodayWarehouse(organizationId, { role, factoryId });
  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--ink-muted)]">{today.facts.join("。")}。</p>
      <section className="space-y-2">
        <h3 className="font-medium">该调到厂 {today.transfer.length}</h3>
        <Card className="overflow-hidden">
          {today.transfer.length === 0 ? (
            <p className="p-4 text-sm text-[var(--ink-muted)]">没有「公司有料、厂里不够」的待调拨。调拨不是领用。</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {today.transfer.map((job) => (
                <li key={`${job.orderId}-${job.materialId}`} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <Link href={job.href} className="font-medium text-[var(--brand-strong)]">
                      {job.orderNo}
                    </Link>
                    <p className="mt-1 text-[var(--ink-muted)]">
                      {job.materialCode} {job.materialName} · 厂里 {job.atFactory}{job.unit} · 还缺 {job.remaining}
                      {job.unit} · {job.factoryName}
                    </p>
                  </div>
                  <Badge>{job.action}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">可占余料 {today.leftover.length}</h3>
        {today.leftover.length > 1 ? (
          <p className="text-xs text-[var(--ink-muted)]">同一批可分配库存可能出现在多张未占单上。采用一单即占住，不是多份余料。</p>
        ) : null}
        <Card className="overflow-hidden">
          {today.leftover.length === 0 ? (
            <p className="p-4 text-sm text-[var(--ink-muted)]">没有待采用的余料方案 A。空库存不等于能用在本单。</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {today.leftover.map((job) => (
                <li key={job.orderId} className="p-4">
                  <Link href={job.href} className="font-medium text-[var(--brand-strong)]">
                    {job.orderNo}
                  </Link>
                  <p className="mt-1 text-[var(--ink-muted)]">
                    {job.label} · {job.factoryName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      <section className="space-y-2">
        <h3 className="font-medium">在途未收 {today.inbound.length}</h3>
        <Card className="overflow-hidden">
          {today.inbound.length === 0 ? (
            <p className="p-4 text-sm text-[var(--ink-muted)]">没有在途未收批次。在途不是现货，也不能当成已入库。</p>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {today.inbound.map((job) => (
                <li key={job.lotId} className="p-4">
                  <Link href={job.href} className="font-medium text-[var(--brand-strong)]">
                    {job.materialCode} {job.colorName}
                  </Link>
                  <p className="mt-1 text-[var(--ink-muted)]">
                    {job.qtyInbound} 在途 · ETA {job.eta} · {job.locationName}
                    {job.orderNos.length ? ` · 已占 ${job.orderNos.join("、")}` : " · 未占到订单"}
                  </p>
                  <Link href={`/resources/materials/${job.materialId}`} className="mt-1 inline-block text-xs text-[var(--brand-strong)]">
                    材料主档
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
