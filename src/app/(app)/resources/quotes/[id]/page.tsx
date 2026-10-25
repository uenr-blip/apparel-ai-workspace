import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getQuoteRecord, ResourceRecordError } from "@/server/services/resource-records";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let record;
  try {
    record = await getQuoteRecord(session.organizationId, id, session);
  } catch (error) {
    if (error instanceof ResourceRecordError) notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="历史报价"
        title={`${record.materialCode} ${record.unitPriceYuan} 元/${record.unit}`}
        description={
          <>
            {record.facts.join("。")}。{" "}
            <Link href="/resources" className="text-[var(--brand-strong)]">
              返回库存与关联资料
            </Link>
          </>
        }
      />
      <Card className="p-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">供应商</dt>
            <dd>
              <Link href={`/resources/parties/${record.supplierId}`} className="text-[var(--brand-strong)]">
                {record.supplierName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">材料</dt>
            <dd>
              <Link href={`/resources/materials/${record.materialId}`} className="text-[var(--brand-strong)]">
                {record.materialCode} {record.materialName}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">单价</dt>
            <dd>
              {record.unitPriceYuan} {record.currency}/{record.unit}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">有效自</dt>
            <dd>{record.validFrom}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">起订</dt>
            <dd>{record.moq}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">倍数</dt>
            <dd>{record.multiple}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--ink-muted)]">采购状态</dt>
            <dd>
              <Badge tone={record.issued ? "warning" : "neutral"}>{record.issued ? "已下达采购" : "未下达采购"}</Badge>
            </dd>
          </div>
        </dl>
        {record.demoNote ? <p className="mt-3 text-xs text-[var(--ink-muted)]">{record.demoNote}</p> : null}
      </Card>
    </div>
  );
}
