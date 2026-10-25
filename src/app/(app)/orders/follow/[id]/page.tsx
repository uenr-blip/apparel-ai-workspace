import { StageExpensePanel } from "@/components/stage-expense-panel";
import { FollowNavigationScope } from "@/components/navigation-scope";
import { constructionPurchaseLines } from "@/server/domain/merch-sheet";
import { readConstruction } from "@/lib/style-construction";
import { resolveStyleCodes } from "@/server/services/style-code";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ACTION_TYPES } from "@/lib/constants";
import { orderColorPieces, purchaseLines, readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { canApproveAction } from "@/server/permissions";
import { getFollowSheet, listFollowProducts } from "@/server/services/order-merch";
import { MerchSheetForm } from "../../merch-sheet-form";
import { FollowEditProvider } from "../../follow-edit-state";
import { OpenFollowOrder } from "../../open-follow-order";
import { WorkflowStagePanel } from "@/components/workflow-stage-panel";
import { getStageWorkspace } from "@/server/services/workflow-stage";

export default async function FollowSheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ row?: string; rowId?: string; stageRevision?: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  const sheet = await getFollowSheet({
    organizationId: session.organizationId,
    sheetId: id,
    role: session.role,
    factoryId: session.factoryId,
  });
  if (!sheet) notFound();
  const styles = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
  const row = query.rowId ? styles.findIndex(s => s.rowId === query.rowId) : Number(query.row ?? 0);
  if (query.rowId && row < 0) notFound();
  const materialStages = await prisma.workflowStage.findMany({ where: { organizationId: session.organizationId, followRowId: { in: styles.map(s => s.rowId!).filter(Boolean) } }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const purchases = styles.flatMap((style) =>
    (materialStages.some(s => s.followRowId === style.rowId) ? constructionPurchaseLines(readConstruction(materialStages.find(s => s.followRowId === style.rowId)?.revisions[0]?.constructionJson), style.salesSample, style.bulk, sheet.kind) : purchaseLines(style.salesSample, style.bulk, sheet.kind)).map((line) => ({
      ...line,
      styleCode: style.styleCode || style.styleName || "未写款号",
    })),
  );
  const intakeAudit = await prisma.auditEvent.findFirst({ where: { organizationId: session.organizationId, entityId: sheet.id, action: "follow.sheet_created" } });
  const intake = intakeAudit?.payloadJson ? JSON.parse(intakeAudit.payloadJson).after?.intake as { sourceId: string; customerId: string } | undefined : undefined;
  const [styleRows, customers, followProducts] = await Promise.all([
    prisma.style.findMany({
      where: { organizationId: session.organizationId, archivedAt: null },
      orderBy: { code: "asc" },
    }),
    prisma.customer.findMany({
      where: { organizationId: session.organizationId, archivedAt: null },
      orderBy: { name: "asc" },
    }),
    listFollowProducts(session.organizationId, { role: session.role, factoryId: session.factoryId }),
  ]);
  const factoryChoices = await prisma.party.findMany({ where: { organizationId: session.organizationId, kind: "factory", OR: [{ archivedAt: null }, { id: sheet.factoryId ?? "__none__" }] }, select: { id: true, name: true } });
  const resolvedCodes = await resolveStyleCodes(prisma, session.organizationId, styles.map(s => s.styleCode));
  const allFollowLines = [...followProducts.sales, ...followProducts.bulk.flatMap(group => group.styles)];
  const relatedByCode: Record<string, { href: string; label: string }[]> = {};
  for (const line of [...followProducts.sales, ...followProducts.bulk.flatMap((group) => group.styles)]) {
    if (!line.key.startsWith(`${sheet.id}:`)) continue;
    const code = line.styleCode.trim().toUpperCase();
    if (code) relatedByCode[code] = line.others;
  }
  const kindLabel = sheet.kind === "sales_sample" ? "销售样" : sheet.kind === "bulk" ? "大货" : "跟单";
  const selectedRow = styles[Number.isInteger(row) && row >= 0 && row < styles.length ? row : 0];
  const stage = selectedRow?.rowId && ["manager", "salesperson"].includes(session.role) && ["sales_sample", "bulk"].includes(sheet.kind) ? await getStageWorkspace({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }, { followRowId: selectedRow.rowId }) : null;
  const transferRows = styles.map(style => {
    const row = sheet.styles.find(r => r.id === style.rowId);
    const line = row?.productionLine;
    return { id: style.rowId!, label: style.styleCode || style.styleName || "未写款号", po: sheet.kind === "sales_sample" ? style.salesSample.po : style.bulk.po, shipDate: style.bulk.shipDate, quantity: orderColorPieces(style, sheet.kind).reduce((n, c) => n + c.quantity, 0), order: line ? { id: line.order.id, orderNo: line.order.orderNo } : null, registered: Boolean(resolvedCodes.get(style.styleCode) && !resolvedCodes.get(style.styleCode)?.archivedAt) };
  });

  return (
    <FollowEditProvider key={sheet.id} expectedUpdatedAt={sheet.updatedAt.toISOString()}><div className="space-y-7">
      <FollowNavigationScope kind={sheet.kind} />
      <PageHeader
        eyebrow="跟单"
        title={sheet.title || "跟单"}
        description={[kindLabel, sheet.factoryName, sheet.seasonCode].filter(Boolean).join(" · ")}
        actions={
          <Link href={sheet.kind === "sales_sample" ? "/orders?sheet=sales" : "/orders?sheet=bulk"} className="text-sm text-[var(--brand-strong)]">
            {sheet.kind === "sales_sample" ? "返回销售样总表" : "返回大货总表"}
          </Link>
        }
      />
      {intake ? <Card className="p-4 text-sm">来源客户：{customers.find(c => c.id === intake.customerId)?.name ?? "待核对"} · <Link className="text-[var(--brand-strong)] underline" href={`/inbox/${intake.sourceId}`}>查看客户原件与核对记录</Link>。后续在此补资料，保存后回查大货总表。</Card> : null}
      {sheet.order && ["manager", "salesperson"].includes(session.role) ? <p className="text-sm"><Link className="underline" href={`/orders/follow/${sheet.id}/changes`}>客户改单与历史</Link> · 已开生产单的颜色、数量和交期在此登记修改。</p> : null}
      <Card className="sheet-pad">
        <div className="mt-1">
          <MerchSheetForm
            orderId={sheet.id}
            materialsRowId={selectedRow?.rowId}
            materialsSection={stage ? <><WorkflowStagePanel key={`${stage.stageId ?? JSON.stringify(stage.target)}:${query.stageRevision ?? ""}`} board={stage} initialRevisionId={query.stageRevision} /><StageExpensePanel actor={{ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }} target={stage.target} /></> : undefined}
            styleImages={Object.fromEntries(styles.map((style, index) => [style.rowId || "", allFollowLines.find(line => line.key.startsWith(`${sheet.id}:${index}:`))?.imageSrc || ""]))}
            materialRowIds={materialStages.filter(s => s.revisions.length).map(s => s.followRowId!)}
            lockedRowIds={sheet.styles.filter(s => s.productionLineId).map(s => s.id)}
            kind={sheet.kind === "sales_sample" || sheet.kind === "bulk" ? sheet.kind : ""}
            factoryName={sheet.factoryName}
            customerId={sheet.customerId ?? sheet.order?.customerId ?? intake?.customerId}
            partners={{ customers: customers.map(c=>({ id:c.id, name:c.name })), factories: factoryChoices }}
            savePath={`/api/orders/follow/${sheet.id}`}
            expectedUpdatedAt={sheet.updatedAt.toISOString()}
            seasonCode={sheet.seasonCode}
            initialStyle={Number.isInteger(row) && row >= 0 && row < styles.length ? row : 0}
            styles={styles}
            shipments={allFollowLines.filter(line => line.key.startsWith(`${sheet.id}:`)).map(line => ({ po: line.po, dates: line.shipmentDates }))}
            styleChoices={styleRows.map((style) => {
              const ids = [...new Set(allFollowLines.filter(line => line.styleCode === style.code).map(line => line.numericCode).filter(Boolean))];
              return { code: style.code, name: style.name, productCode: ids.length === 1 ? ids[0] : undefined };
            })}
            purchases={purchases}
            canEdit={canApproveAction(session.role, ACTION_TYPES.saveOrderMerch)}
            relatedByCode={relatedByCode}
          />
        </div>
      </Card>
      {canApproveAction(session.role, ACTION_TYPES.openFollowOrder) ? (
        <Card id="follow-open-order" className="sheet-pad scroll-mt-24">
          <details><summary className="cursor-pointer font-medium">资料核对完成后 · 开成生产订单</summary><div className="mt-4">
          <OpenFollowOrder
            sheetId={sheet.id}
            expectedUpdatedAt={sheet.updatedAt.toISOString()}
            initialCustomerId={sheet.customerId ?? sheet.order?.customerId ?? intake?.customerId}
            rows={transferRows}
            customers={customers.filter(c => !intake || c.id === intake.customerId).map((customer) => ({ id: customer.id, label: customer.name }))}
            order={sheet.order ? { id: sheet.order.id, orderNo: sheet.order.orderNo } : null}
          />
          </div></details>
        </Card>
      ) : null}
    </div></FollowEditProvider>
  );
}
