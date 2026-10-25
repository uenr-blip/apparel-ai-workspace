import { productionConstructionReferences } from "@/server/services/production-construction-reference";
import { StyleConstructionSummary } from "@/app/(app)/styles/style-construction-fields";
import { constructionPublic } from "@/lib/style-construction";
import { constructionRows } from "@/server/services/style-construction";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { BridgePanel } from "../../finance/bridge-panel";
import { ledgerPermissions } from "@/server/services/ledger-db";
import { tradePermissions } from "@/server/services/trade-db";
import { Badge, Card } from "@/components/ui/card";
import { SheetHead, Tile } from "@/components/ui/sheet";
import { DeskTabs } from "@/components/ui/desk-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction, canSeeFactory } from "@/server/permissions";
import { OrderPrepForm } from "@/app/(app)/orders/order-prep-form";
import { SpecApproveForm } from "@/app/(app)/orders/spec-approve-form";
import { ColorConfirmForm } from "@/app/(app)/orders/color-confirm-form";
import { getOrderPrepContext } from "@/server/services/order-prep";
import { listStyleFillPack } from "@/server/services/oral-order";
import { getOrderMaterialPlan } from "@/server/services/material-plan";
import { leftoverNextStep } from "@/server/domain/leftover-next";
import { bulkDeskNext } from "@/server/domain/bulk-desk-next";
import { materialDeskCopy } from "@/server/domain/material-desk";
import { getOrderMaterialSupply } from "@/server/services/order-material-supply";
import { getPurchaseOptions } from "@/server/services/purchase-options";
import { getColorConfirmationBoard } from "@/server/services/color-confirm";
import { InboundEtaForm } from "@/app/(app)/orders/inbound-eta-form";
import { ReferenceBomForm } from "@/app/(app)/orders/reference-bom-form";
import { AdoptPurchaseForm } from "@/app/(app)/orders/adopt-purchase-form";
import { AssignFactoryForm } from "@/app/(app)/orders/assign-factory-form";
import { ProductionGateForm } from "@/app/(app)/orders/production-gate-form";
import { OrderMoneyCard } from "@/app/(app)/orders/order-money-card";
import { getProductionGate } from "@/server/services/production-gate";
import { getOrderMoney } from "@/server/services/order-money";
import { listOrderChainProposals } from "@/server/services/chain-proposals";
import { ChainProposalsCard } from "@/app/(app)/orders/chain-proposals-card";
import { MerchSheetForm } from "@/app/(app)/orders/merch-sheet-form";
import { labels } from "@/lib/labels";
import { suggestedDeliveryDate } from "@/lib/delivery-year";
import { quantityText } from "@/lib/material-quantity";
import { purchaseLines, readStoredMerchStyles } from "@/server/domain/merch-sheet";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const financeActor = {organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId};
  const tradeCaps = await tradePermissions(financeActor);
  const canFinanceBridge = tradeCaps.has("trade_view") && (await ledgerPermissions(financeActor)).has("ledger_view");
  const order = await prisma.salesOrder.findFirst({
    where: { id, organizationId: session.organizationId },
    include: {
      factory: true,
      customer: true,
      createdBy: true,
      source: true,
      organization: true,
      lines: { include: { style: true, version: { include: { bomLines: { include: { material: true } }, attachments: true } }, colors: { include: { sizes: true } } } },
      tasks: true,
      production: true,
      merchSheet: { include: { styles: { orderBy: { sort: "asc" } } } },
    },
  });
  if (!order || !canSeeFactory(session.role, session.factoryId, order.factoryId)) notFound();
  const materialReferences = await productionConstructionReferences(session.organizationId, order.id);
  const timeline = await prisma.auditEvent.findMany({
    where: { organizationId: session.organizationId, entityId: { in: [order.id, order.sourceDocumentId ?? ""] } },
    orderBy: { createdAt: "desc" },
  });
  const [prep, materialPlan, materialSupply, colorBoard, purchaseOptions, factories, stylePack, productionGate, orderMoney, chainProposals] = await Promise.all([
    getOrderPrepContext(session.organizationId, order.id),
    getOrderMaterialPlan(session.organizationId, order.id),
    getOrderMaterialSupply(session.organizationId, {
      id: order.id,
      factoryId: order.factoryId,
      started: order.production.some((row) => row.kind === "started" && row.quantity > 0),
    }),
    getColorConfirmationBoard(session.organizationId, order.id),
    getPurchaseOptions(session.organizationId, order.id),
    prisma.party.findMany({
      where: { organizationId: session.organizationId, kind: "factory" },
      orderBy: { name: "asc" },
    }),
    order.lines[0]?.styleId
      ? listStyleFillPack(session.organizationId, order.lines[0].styleId)
      : Promise.resolve({ styleId: "", colors: [], materials: [] }),
    getProductionGate(session.organizationId, order.id),
    getOrderMoney(session.organizationId, order.id),
    listOrderChainProposals(session.organizationId, order.id),
  ]);
  const canRoleEdit = session.role === "salesperson" || session.role === "manager";
  const sizeCodes = prep.sizeCodes;
  const colors = order.lines.flatMap((line) =>
    line.colors.map((color) => ({
      colorName: color.colorName,
      quantity: color.quantity,
      sizes: color.sizes.map((size) => ({ sizeCode: size.sizeCode, quantity: size.quantity })),
    })),
  );
  const draftSpec = order.lines.map((line) => line.version?.specNotes ?? "").find((value) => value.trim()) ?? "";
  const fallbackStyle = order.lines[0]?.style;
  const merchStyles = readStoredMerchStyles(order.merchSheet, {
    styleCode: fallbackStyle?.code ?? "",
    styleName: fallbackStyle?.name ?? "",
  });
  const merchPurchases = merchStyles.flatMap((style) =>
    purchaseLines(style.salesSample, style.bulk, order.merchSheet?.kind).map((line) => ({
      ...line,
      styleCode: style.styleCode || style.styleName || "未写款号",
    })),
  );
  const styleChoices = await prisma.style.findMany({
    where: { organizationId: session.organizationId },
    select: { code: true, name: true },
    orderBy: { code: "asc" },
  });
  const leftover = leftoverNextStep({
    started: order.production.some((row) => row.kind === "started" && row.quantity > 0),
    comparable: purchaseOptions.lines.length > 0,
    freeStock: purchaseOptions.lines[0]?.freeStock ?? "0",
    adopted: purchaseOptions.adopted,
  });
  const canAdopt = canApproveAction(session.role, ACTION_TYPES.adoptPurchaseOption);
  const blockedLine = materialSupply.lines.find((line) => line.blocker) ?? null;
  const purchaseLine = purchaseOptions.lines.find((line) => line.materialId === blockedLine?.materialId) ?? purchaseOptions.lines[0];
  const inboundOpen = purchaseLine ? String(Number(purchaseLine.timelyInbound) + Number(purchaseLine.lateInbound)) : null;
  const receiptRows = blockedLine
    ? await prisma.materialReceipt.findMany({
        where: { organizationId: session.organizationId, orderId: order.id, materialId: blockedLine.materialId, status: "active" },
        select: { qtyMilli: true },
      })
    : [];
  const receivedQty = receiptRows.length
    ? quantityText(receiptRows.reduce((sum, row) => sum + row.qtyMilli, BigInt(0)))
    : null;
  const deskNext = bulkDeskNext({
    orderId: order.id,
    orderNo: order.orderNo,
    alreadyReleased: productionGate.alreadyReleased,
    alreadyDone: productionGate.alreadyDone,
    checks: productionGate.checks,
    cutBlockers: materialSupply.blockers,
    material: blockedLine
      ? {
          materialCode: blockedLine.materialCode,
          unit: blockedLine.unit,
          gross: blockedLine.gross,
          companyOnHand: blockedLine.companyOnHand,
          atFactory: blockedLine.atFactory,
        }
      : null,
    purchase:
      purchaseOptions.adopted && (!blockedLine || purchaseOptions.adopted.materialId === blockedLine.materialId)
        ? {
            optionCode: purchaseOptions.adopted.optionCode,
            qty: purchaseOptions.adopted.qty,
            status: purchaseOptions.adopted.status,
          }
        : null,
    inboundOpen,
    receivedQty,
  });
  const materialDesk = materialDeskCopy({
    supplyLabel: materialSupply.label,
    supplyFacts: materialSupply.facts,
    planFacts: materialPlan.facts,
    purchaseFacts: purchaseOptions.facts,
    supplyLineCount: materialSupply.lines.length,
    purchaseLineCount: purchaseOptions.lines.length,
  });
  const materialQuiet =
    materialSupply.lines.length === 0 &&
    purchaseOptions.lines.length === 0 &&
    purchaseOptions.inboundLots.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={order.customer.name}
        title={order.orderNo}
        description={`建单 ${order.createdBy?.name ?? "未记"}。这一单下面直接列款。先看提案、收付、门槛和料况；色尺、补资料、分色、工厂和记账在本单资料页签。`}
        actions={
          <>
            <Badge>{labels.orderStatus(order.status)}</Badge>
            <Badge tone={order.productionReadiness.includes("blocked") || order.productionReadiness === "spec_approved" ? "warning" : "ok"}>
              {labels.readiness(order.productionReadiness)}
            </Badge>
          </>
        }
      />
      <div className="desk-squares">
        <ChainProposalsCard
          proposals={chainProposals.proposals}
          reasons={chainProposals.reasons}
          role={session.role}
        />
        <OrderMoneyCard
          money={orderMoney}
          canOpenFinance={tradeCaps.has("trade_view")}
          showCustomer={session.role !== "factory"}
        />
        <Card id="production-gate" className="scroll-mt-24 desk-square desk-gate">
          <ProductionGateForm
            orderId={order.id}
            expectedUpdatedAt={prep.expectedUpdatedAt}
            canRelease={canApproveAction(session.role, ACTION_TYPES.releaseToProduction)}
            alreadyReleased={productionGate.alreadyReleased}
            alreadyDone={productionGate.alreadyDone}
            ready={productionGate.ready}
            label={productionGate.label}
            checks={productionGate.checks}
            facts={productionGate.facts}
            next={deskNext}
          />
        </Card>
      </div>
      {materialQuiet ? (
        <p id="material-supply" className="scroll-mt-24 text-sm text-[var(--ink-muted)]">
          还没有面辅料，余料和开裁先不算。
        </p>
      ) : (
          <Card id="material-supply" className="scroll-mt-24 sheet-pad">
            <SheetHead title="本单料况" hint="规格齐了先占余料，再看开裁。调拨不是领用。采购单不是到料，也不是付款。" />
            <p className="mt-4 text-sm font-medium leading-6">{leftover.label}</p>
            {materialDesk.supplyLabel ? (
              <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{materialDesk.supplyLabel}</p>
            ) : null}
            {materialSupply.lines.length ? (
              <div className="sheet-well mt-4 overflow-x-auto">
                <table className="sheet-table min-w-[640px] text-sm">
                  <thead>
                    <tr>
                      <th>材料</th>
                      <th>毛需求</th>
                      <th>公司在手</th>
                      <th>本单占用</th>
                      <th>厂里</th>
                      <th>已领</th>
                      <th>开裁</th>
                    </tr>
                  </thead>
                  <tbody>
                    {materialSupply.lines.map((line) => (
                      <tr key={line.materialId}>
                        <td>
                          <Link href={`/resources?materialId=${line.materialId}`} className="text-[var(--brand-strong)]">
                            {line.materialCode} {line.materialName}
                          </Link>
                        </td>
                        <td className="tabular-nums">{line.gross ?? "—"} {line.unit}</td>
                        <td className="tabular-nums">{line.companyOnHand}</td>
                        <td className="tabular-nums">{line.allocatedToOrder}</td>
                        <td className="tabular-nums">{line.atFactory}</td>
                        <td className="tabular-nums">{line.consumed}</td>
                        <td className={line.blocker ? "text-[var(--warning)]" : undefined}>
                          {line.blocker ?? (materialSupply.canCut ? materialSupply.label : "—")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">{materialDesk.emptyNote}</p>
            )}
            {materialSupply.lines.length === 0 && purchaseOptions.lines.length > 0 && canRoleEdit ? (
              <ReferenceBomForm orderId={order.id} />
            ) : null}
            <div id="leftover-plan" className="mt-6 space-y-3">
              <SheetHead
                title="余料方案"
                hint={
                  purchaseOptions.poIssued
                    ? `规则计算。采购单已下达，未收料，未付款。差额不是利润。材料需求日 ${purchaseOptions.supplyNeedDate ?? "待核实"}。`
                    : `规则计算，未下达采购。差额不是利润。材料需求日 ${purchaseOptions.supplyNeedDate ?? "待核实"}。`
                }
              />
              {purchaseOptions.lines.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--ink-muted)]">还不能比较：没有已确认面料需求或缺少报价依据。</p>
              ) : (
                purchaseOptions.lines.map((line) => (
                  <Tile
                    key={line.materialId}
                    className={`text-sm leading-6 ${leftover.kind === "ready" || leftover.kind === "stale" ? "ring-1 ring-[var(--brand)]" : ""}`}
                  >
                    <p className="font-medium">
                      {line.materialCode} {line.materialName} · 毛需求 {line.gross} {line.unit}
                    </p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      可分配库存 {line.freeStock} · 及时在途 {line.timelyInbound}
                      {line.lateInbound !== "0" ? ` · 迟到在途 ${line.lateInbound}（不得抵扣）` : ""}
                    </p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className={leftover.recommend === "A" ? "rounded-md bg-[var(--nav-active-bg)] p-2" : ""}>
                        <p>方案 A 用余料+及时在途{leftover.recommend === "A" ? " · 建议" : ""}</p>
                        <p>净需求 {line.optionA.net} · 建议购 {line.optionA.buy} {line.unit}</p>
                        <p>采购行 {line.optionA.amountYuan} 元 · 计划结余 {line.optionA.plannedExcess} {line.unit}</p>
                      </div>
                      <div className={leftover.recommend === "B" ? "rounded-md bg-[var(--nav-active-bg)] p-2" : ""}>
                        <p>方案 B 不用历史余料{leftover.recommend === "B" ? " · 建议" : ""}</p>
                        <p>净需求 {line.optionB.net} · 建议购 {line.optionB.buy} {line.unit}</p>
                        <p>采购行 {line.optionB.amountYuan} 元 · 计划结余 {line.optionB.plannedExcess} {line.unit}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-[var(--warning)]">
                      新增采购支出差额 {line.spendDifferenceYuan} 元，不是利润增加。
                    </p>
                    <AdoptPurchaseForm
                      orderId={order.id}
                      materialId={line.materialId}
                      expectedSnapshot={line.snapshot}
                      canEdit={canAdopt}
                      canIssue={canApproveAction(session.role, ACTION_TYPES.issuePurchaseOrder)}
                      adopted={
                        purchaseOptions.adopted?.materialId === line.materialId
                          ? {
                              optionCode: purchaseOptions.adopted.optionCode,
                              qty: purchaseOptions.adopted.qty,
                              amountYuan: purchaseOptions.adopted.amountYuan,
                              status: purchaseOptions.adopted.status,
                              updatedAt: purchaseOptions.adopted.updatedAt,
                            }
                          : null
                      }
                    />
                  </Tile>
                ))
              )}
            </div>
            <ul className="mt-3 space-y-1 text-xs text-[var(--ink-muted)]">
              {materialDesk.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <InboundEtaForm
              orderId={order.id}
              lots={purchaseOptions.inboundLots}
              canEdit={session.role === "manager"}
            />
          </Card>
      )}
      <Card id="order-materials" className="scroll-mt-24 p-5">
        <SheetHead title="本单面料、纱线、辅料与特殊工艺" hint="按本生产单指定的资料版本显示。开单后更换用料须由负责人核对并走资料修订，工厂按已批准资料接续。" />
        {order.lines.map(line => <section className="mt-4 border-t border-[var(--line)] pt-4" key={line.id}>
          <h3 className="font-medium">{line.style.code} · {line.style.name} · {line.version ? `资料 V${line.version.versionNumber}（${line.version.status === "approved" ? "已批准" : "待核对"}）` : "资料版本待指定"}</h3>
          <StyleConstructionSummary rows={constructionPublic(constructionRows(line.version))} references={materialReferences[line.id]} styleId={line.styleId} versionId={line.version?.id || ""} />
          {line.version?.processNotes ? <details className="mt-3 text-sm"><summary>本版原工艺说明</summary><p className="whitespace-pre-wrap">{line.version.processNotes}</p></details> : null}
        </section>)}
      </Card>
      <Card id="merch" className="scroll-mt-24">
        <SheetHead title="这一单的款" hint="销售样和大货都写在这一单上。一单里可以有很多款，不用点进单个款式才找得到。" />
        <div className="mt-4">
          <MerchSheetForm
            orderId={order.id}
            kind={order.merchSheet?.kind === "bulk" || order.merchSheet?.kind === "sales_sample" ? order.merchSheet.kind : ""}
            batchLocked={Boolean(order.merchSheet?.kind)}
            expectedUpdatedAt={order.merchSheet?.updatedAt.toISOString() ?? ""}
            seasonCode={order.merchSheet?.seasonCode ?? ""}
            styles={merchStyles}
            shipments={order.externalCustomerPo ? [{ po: order.externalCustomerPo, dates: [...new Set(order.production.filter(row => row.kind === "shipped").map(row => row.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })))] }] : []}
            styleChoices={styleChoices}
            purchases={merchPurchases}
            canEdit={canApproveAction(session.role, ACTION_TYPES.saveOrderMerch) && order.productionReadiness !== "shipped"}
          />
        </div>
      </Card>
      <Card id="order-docs" className="scroll-mt-24">
        <DeskTabs
          items={[
            {
              id: "sizes",
              label: "色尺",
              hash: "sizes",
              children: (
                <>
                  {order.lines.map((line) => {
                    const filled = line.colors.reduce(
                      (sum, color) => sum + color.sizes.reduce((inner, size) => inner + size.quantity, 0),
                      0,
                    );
                    return (
                      <div key={line.id} className="first:mt-0 mt-5">
                        <Link href={`/styles/${line.styleId}`} className="text-[var(--brand-strong)]">
                          {line.style.code} {line.style.name}
                        </Link>
                        <p className="mt-1 text-xs leading-6 text-[var(--ink-muted)]">
                          资料版本 {line.version ? `第 ${line.version.versionNumber} 版（${line.version.status === "approved" ? "已批准" : "草稿"}）` : "未指定"}
                          {line.version?.specNotes ? ` · ${line.version.specNotes}` : ""}
                        </p>
                        <div className="sheet-well mt-3 overflow-x-auto">
                          <table className="sheet-table min-w-[520px] text-sm">
                            <thead>
                              <tr>
                                <th>颜色</th>
                                <th>件数</th>
                                {sizeCodes.map((code) => (
                                  <th key={code}>{code}</th>
                                ))}
                                <th>已填</th>
                                <th>差异</th>
                              </tr>
                            </thead>
                            <tbody>
                              {line.colors.map((color) => {
                                const colorFilled = color.sizes.reduce((sum, size) => sum + size.quantity, 0);
                                return (
                                  <tr key={color.id}>
                                    <td>{color.colorName}</td>
                                    <td className="tabular-nums">{color.quantity}</td>
                                    {sizeCodes.map((code) => {
                                      const qty = color.sizes.find((size) => size.sizeCode === code)?.quantity;
                                      return (
                                        <td key={code} className="tabular-nums">
                                          {qty ?? "未知"}
                                        </td>
                                      );
                                    })}
                                    <td className="tabular-nums">{colorFilled}</td>
                                    <td className={colorFilled === color.quantity ? "tabular-nums text-[var(--ok)]" : "tabular-nums text-[var(--danger)]"}>
                                      {colorFilled - color.quantity}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-3 text-sm leading-6">
                          本款已填 {filled} / 订单 {line.totalQuantity}
                        </p>
                      </div>
                    );
                  })}
                  <dl className="mt-5 grid gap-3 text-sm leading-6 md:grid-cols-2">
                    <div>
                      <dt className="text-[11px] tracking-[0.16em] text-[var(--ink-muted)]">客户 PO</dt>
                      <dd className="mt-1">{order.externalCustomerPo ?? "空"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.16em] text-[var(--ink-muted)]">交期原文</dt>
                      <dd className="mt-1">{order.requestedDeliveryText ?? "空"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.16em] text-[var(--ink-muted)]">确认交期</dt>
                      <dd className="mt-1">{order.requestedDeliveryDate ?? "未确认"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-[0.16em] text-[var(--ink-muted)]">年份推断</dt>
                      <dd className="mt-1">{order.deliveryYearInference ?? "无"}</dd>
                    </div>
                  </dl>
                </>
              ),
            },
            {
              id: "prep",
              label: "补资料",
              hash: "prep",
              children: (
                <>
                  <ul className="space-y-2 text-sm leading-6">
                    {order.tasks.map((task) => (
                      <li key={task.id}>
                        <Badge tone={task.status === "done" ? "ok" : "warning"}>
                          {task.status === "done" ? "已完成" : "未完成"} · {labels.taskKind(task.kind)}
                        </Badge>{" "}
                        {task.title}
                      </li>
                    ))}
                  </ul>
                  {order.notes ? <p className="mt-3 text-sm">{order.notes}</p> : null}
                  {order.source ? (
                    <p className="mt-3 text-sm">
                      来源（{labels.origin(order.source.origin)}）：
                      <Link href={`/inbox/${order.source.id}`}>查看原始资料</Link>
                    </p>
                  ) : null}
                  <OrderPrepForm
                    key={order.id}
                    orderId={order.id}
                    sizeCodes={sizeCodes}
                    colors={colors}
                    expectedUpdatedAt={prep.expectedUpdatedAt}
                    ribSpec={draftSpec}
                    deliveryDate={order.requestedDeliveryDate ?? ""}
                    deliveryText={order.requestedDeliveryText}
                    deliveryYearInference={order.deliveryYearInference}
                    suggestedDeliveryDate={suggestedDeliveryDate(order.requestedDeliveryText)}
                    canEdit={prep.canEdit}
                    demoNote={order.organization.demoNote}
                    roleBlocked={!canRoleEdit}
                    colorOptions={stylePack.colors}
                  />
                  <SpecApproveForm
                    orderId={order.id}
                    expectedUpdatedAt={prep.expectedUpdatedAt}
                    canApprove={session.role === "manager"}
                    hasDraft={order.lines.some((line) => line.version?.status === "draft")}
                    hasSpec={Boolean(draftSpec.trim())}
                    alreadyApproved={order.lines.some((line) => line.version?.status === "approved")}
                  />
                </>
              ),
            },
            {
              id: "color-confirm",
              label: "分色",
              hash: "color-confirm",
              children: (
                <ColorConfirmForm
                  orderId={order.id}
                  board={colorBoard}
                  canEdit={prep.canEdit && canApproveAction(session.role, ACTION_TYPES.recordColorConfirmation)}
                />
              ),
            },
            {
              id: "factory",
              label: "工厂",
              hash: "factory",
              children: (
                <>
                  <p className="text-xs leading-6 text-[var(--ink-muted)]">
                    派给本组织工厂后，工厂账号才能在进度台看到这一单。不是调拨，也不是开裁。
                  </p>
                  <p className="mt-3 text-sm leading-6">当前：{order.factory?.name ?? "未指定工厂"}</p>
                  {["manager", "salesperson"].includes(session.role) && order.factoryId ? <Link className="mt-3 inline-block text-sm underline" href={`/orders/${order.id}/transfers`}>转厂登记与交接记录（全部余量 / 部分颜色数量）</Link> : null}
                  <div className="mt-3">
                    <AssignFactoryForm
                      orderId={order.id}
                      factoryId={order.factoryId}
                      factories={factories}
                      canEdit={canApproveAction(session.role, ACTION_TYPES.assignOrderFactory) && order.productionReadiness !== "shipped"}
                    />
                  </div>
                </>
              ),
            },
            ...(canFinanceBridge
              ? [
                  {
                    id: "ledger",
                    label: "记账",
                    hash: "ledger",
                    children: <BridgePanel actor={financeActor} filter={{ orderId: id }} compact />,
                  },
                ]
              : []),
            {
              id: "timeline",
              label: "时间线",
              hash: "timeline",
              children: (
                <ol className="space-y-3 text-sm leading-6">
                  {timeline.map((event) => (
                    <li key={event.id}>{event.summary}</li>
                  ))}
                </ol>
              ),
            },
          ]}
        />
      </Card>

    </div>
  );
}
