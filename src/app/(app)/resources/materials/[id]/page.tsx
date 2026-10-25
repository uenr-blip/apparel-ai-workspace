import { notFound } from "next/navigation";
import { TablePhoto } from "@/components/table-photo";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { ACTION_TYPES } from "@/lib/constants";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canApproveAction } from "@/server/permissions";
import { getMaterialRecord, MaterialRecordError } from "@/server/services/material-record";
import { MaterialCardForm } from "../material-card-form";
import { MaterialImageForm } from "../material-image-form";

export default async function MaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (session.role === "factory") notFound();
  const { id } = await params;
  let record;
  try {
    record = await getMaterialRecord(session.organizationId, id);
  } catch (error) {
    if (error instanceof MaterialRecordError) notFound();
    throw error;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={record.kindLabel}
        title={`${record.code} ${record.name}`}
        description={
          <>
            {record.specSummary} ·{" "}
            <Link href="/styles?tab=materials" className="text-[var(--brand-strong)]">
              返回面辅料库
            </Link>
            {" · "}
            <Link href="/resources" className="text-[var(--brand-strong)]">
              库存批次
            </Link>
            {" · "}
            <Link href={`/styles?tab=design&materialId=${record.id}`} className="text-[var(--brand-strong)]">
              用这料做设计
            </Link>
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
          <div className="bg-[var(--paper)] p-4">
            {record.imageSrc ? (
              <TablePhoto
                src={record.imageSrc}
                label={`${record.name}材料图`}
                className="w-full [&>img]:h-56 [&>img]:w-full [&>img]:rounded-xl [&>img]:object-contain"
              />
            ) : (
              <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-[var(--line)] text-sm text-[var(--ink-muted)]">
                还没有色卡图
              </div>
            )}
            <MaterialImageForm
              materialId={record.id}
              canEdit={canApproveAction(session.role, ACTION_TYPES.createMaterialMaster)}
            />
          </div>
          <div className="p-5">
            <h3 className="font-medium">材料主档</h3>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{record.facts.join("。")}。供应商和单价在历史报价，色号和库存在批次，采购草稿在订单料况。</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">货号</dt>
                <dd className="font-medium">{record.code}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">名称</dt>
                <dd>{record.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">种类</dt>
                <dd>{record.kindLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">成分</dt>
                <dd>{record.composition || "未填"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">克重</dt>
                <dd>{record.gsm ? `${record.gsm}g/m²` : "未填"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">幅宽</dt>
                <dd>{record.widthCm ? `${record.widthCm}cm` : "未填"}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">规格</dt>
                <dd>{record.specSummary}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">单位</dt>
                <dd>{record.unit}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--ink-muted)]">建档</dt>
                <dd>{record.createdByName || "未记"}{record.createdAt ? ` · ${record.createdAt.slice(0, 10)}` : ""}</dd>
              </div>
            </dl>
            <MaterialCardForm
              materialId={record.id}
              canEdit={canApproveAction(session.role, ACTION_TYPES.createMaterialMaster)}
              composition={record.composition}
              gsm={record.gsm}
              widthCm={record.widthCm}
              specSummary={record.specSummary}
            />
            {record.demoNote ? <p className="mt-3 text-xs text-[var(--ink-muted)]">{record.demoNote}</p> : null}
          </div>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <h3 className="font-medium">批次地点</h3>
          <Link href={`/resources?materialId=${record.id}`} className="mt-2 block text-sm text-[var(--brand-strong)]">筛选这款材料的现有批次</Link>
          <p className="mt-2 text-[var(--ink-muted)]">
            公司在手合计 {record.companyOnHand} {record.unit}。地点变了合计可以不变。调拨不是领用。
          </p>
          <ul className="mt-3 space-y-2">
            {record.lots.length === 0 ? <li className="text-[var(--ink-muted)]">还没有库存批次</li> : null}
            {record.lots.map((lot) => (
              <li key={lot.id}>
                <Link href={`/resources/lots/${lot.id}`} className="text-[var(--brand-strong)]">
                  {lot.colorName} · {lot.locationName}
                </Link>
                <Badge className="ml-2">{lot.locationKindLabel}</Badge>
                <div className="mt-1 text-[var(--ink-muted)]">
                  在手 {lot.qtyOnHand} / 占用 {lot.qtyAllocated}
                  {lot.qtyInbound !== "0" ? ` / 在途 ${lot.qtyInbound}` : ""}
                  {lot.inboundEta ? ` · ETA ${lot.inboundEta}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 text-sm">
          <h3 className="font-medium">历史报价</h3>
          <ul className="mt-3 space-y-2">
            {record.quotes.length === 0 ? <li className="text-[var(--ink-muted)]">还没有报价</li> : null}
            {record.quotes.map((quote) => (
              <li key={quote.id}>
                <Link href={`/resources/quotes/${quote.id}`} className="text-[var(--brand-strong)]">
                  {quote.supplierName} {quote.unitPriceYuan} 元/{quote.unit}
                </Link>
                <span className="ml-2 text-[var(--warning)]">历史报价，不是本项目已确认成本</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 text-sm">
          <h3 className="font-medium">用在哪款 / 哪个开发</h3>
          <ul className="mt-3 space-y-2">
            {record.usedByStyles.length === 0 && record.usedByProjects.length === 0 ? (
              <li className="text-[var(--ink-muted)]">还没有被款式引用</li>
            ) : null}
            {record.usedByStyles.map((line) => (
              <li key={line.id}>
                <Link href={`/styles/${line.styleId}`} className="text-[var(--brand-strong)]">
                  {line.styleCode}
                </Link>{" "}
                V{line.versionNumber}
                {line.confirmed ? "" : " · 单耗未确认"}
              </li>
            ))}
            {record.usedByProjects.map((row) => (
              <li key={row.id}>
                开发款式{" "}
                <Link href={`/projects/${row.projectId}`} className="text-[var(--brand-strong)]">
                  {row.projectCode}
                </Link>
                <Badge className="ml-2">引用</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5 text-sm">
          <h3 className="font-medium">库存凭证</h3>
          <ul className="mt-3 space-y-2">
            {record.movements.length === 0 ? <li className="text-[var(--ink-muted)]">还没有调拨或领用</li> : null}
            {record.movements.map((row) => (
              <li key={row.id}>
                {row.kind === "transfer" ? "调拨" : "领用"} {row.qty} {record.unit}
                {row.note ? ` · ${row.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
