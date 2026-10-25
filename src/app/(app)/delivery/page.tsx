import { listFactoryTransfers } from "@/server/services/factory-transfer";
import { FactoryTransferRecords } from "@/components/factory-transfer-records";
import { ViewSelect } from "@/components/view-select";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { CatalogSearch } from "@/components/catalog-search";
import { buildCatalogHref, catalogQuery, matchesCatalogQuery } from "@/lib/catalog-query";
import { labels } from "@/lib/labels";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import {
  BOARD_VIEWS,
  filterProductionRows,
  getProductionBoard,
  parseBoardView,
  type ProductionBoardRow,
} from "@/server/services/production-board";
import { RecordProductionForm } from "./record-production-form";
import { ReleaseProductionForm } from "./release-production-form";
import { ColorSizeDialog } from "./color-size-dialog";
import { PackingDialog } from "./packing-dialog";
import { CreatePackingForm } from "./create-packing-form";
import { ReconDraftForm } from "./recon-form";

function deliveryHref(view: string, q: string) {
  return buildCatalogHref("/delivery", view === "all" ? {} : { view }, q);
}

function groupRows(rows: ProductionBoardRow[]) {
  const groups = new Map<string, ProductionBoardRow[]>();
  for (const row of rows) {
    const current = groups.get(row.factoryName) ?? [];
    current.push(row);
    groups.set(row.factoryName, current);
  }
  return [...groups.entries()].map(([factoryName, items]) => ({ factoryName, rows: items }));
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const q = catalogQuery(params.q);
  const view = parseBoardView(params.view);
  const board = await getProductionBoard(session.organizationId, {
    userId: session.id,
    role: session.role,
    factoryId: session.factoryId,
  });
  const transferRecords = ["manager", "salesperson", "factory"].includes(session.role) ? await listFactoryTransfers({ organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId }) : [];
  const recordable = board.rows.filter((row) => row.canRecord);
  const pendingRelease = board.rows.filter(
    (row) => row.started === 0 && row.shipped === 0 && row.readiness !== "ready_for_production" && row.readiness !== "shipped",
  );
  const canRelease = canApproveAction(session.role, ACTION_TYPES.releaseToProduction);
  const canPack = board.rows.some(row => row.canPackDraft);
  const canRecon = board.rows.some(row => row.canRecon || row.recon);
  const viewed = filterProductionRows(board.rows, view);
  const rows = viewed.filter((row) =>
    matchesCatalogQuery(q, [
      row.orderNo,
      row.factoryName,
      row.customerName,
      row.styleCodes,
      row.progress.label,
      row.readiness,
      labels.productionStage(row.stage),
      labels.readiness(row.readiness),
      ...row.owners.roles,
      ...row.exceptions,
      ...row.watch.spec,
      ...row.watch.fabric,
      row.cut.label,
      ...row.watch.colorCard,
      ...row.colorSize.colors.map((color) => color.colorName),
      ...row.packing.plans.flatMap((plan) => plan.cartons.flatMap((carton) => carton.colors)),
    ]),
  );
  const groups = groupRows(rows);
  const extras: Record<string, string> = view === "all" ? {} : { view };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="进度与执行"
        title="工厂生产"
        description="先看进度和阻塞，点订单处理本单的生产、装箱与出运。"
        actions={
          <div className="flex flex-wrap gap-2">
            {["manager", "salesperson"].includes(session.role) ? <BusinessAgentEntry module="production" /> : null}
            <CatalogCompose
              label="登记产量"
              title="登记产量"
              note="选已投产订单后按本单色尺填。重复提交只记一次，返工不会增加合格件数。"
            >
              {recordable.length ? (
                <RecordProductionForm orders={recordable} />
              ) : (
                <p className="text-sm leading-6 text-[var(--ink-muted)]">
                  当前角色不能登记产量，或还没有已投产可填的订单。批准投产后才出现色尺。
                </p>
              )}
            </CatalogCompose>
            {canRelease || canPack || canRecon ? <CatalogCompose variant="outline" label="更多操作" title="生产操作" note="按当前业务阶段选择操作，再核对具体订单。">
              <div className="space-y-4">
                {["manager", "salesperson"].includes(session.role) ? <details className="rounded-lg border border-[var(--line)] p-4"><summary className="cursor-pointer font-medium">转厂与交接</summary><p className="my-2 text-sm">选择原生产单，按未开工、裁片或车缝半成品登记，可整批或部分转出；核对影响后主管确认。</p><div className="max-h-72 overflow-y-auto space-y-2">{board.rows.filter(r => r.factoryId && r.readiness !== "shipped").map(r => <p key={r.orderId}><Link className="text-sm underline" href={`/orders/${r.orderId}/transfers`}>{r.orderNo} · {r.factoryName}</Link></p>)}</div></details> : null}
                {canRelease ? <details className="rounded-lg border border-[var(--line)] p-4">
                  <summary className="cursor-pointer font-medium">批准投产</summary>
                  <p className="my-3 text-sm text-[var(--ink-muted)]">选定已有订单。资料、分色、厂里有料都齐才能过。</p>
                  <ReleaseProductionForm canRelease={canRelease} orders={pendingRelease.map(row => ({ orderId: row.orderId, orderNo: row.orderNo, styleCodes: row.styleCodes, factoryName: row.factoryName, readiness: row.readiness }))} />
                </details> : null}
                {canPack ? <details className="rounded-lg border border-[var(--line)] p-4">
                  <summary className="cursor-pointer font-medium">余货装箱</summary>
                  <p className="my-3 text-sm text-[var(--ink-muted)]">按本单色尺填箱。混色混码可以同箱，箱明细合计须等于箱件数。保存草稿不算实发。</p>
                  <CreatePackingForm orders={board.rows} />
                </details> : null}
                {canRecon ? <details className="rounded-lg border border-[var(--line)] p-4">
                  <summary className="cursor-pointer font-medium">工厂对账草稿</summary>
                  <p className="my-3 text-sm text-[var(--ink-muted)]">按已配置的计价基准和合格出运件数生成草稿。未配置则待核实，不会自动付款。</p>
                  <ReconDraftForm orders={board.rows} />
                </details> : null}
              </div>
            </CatalogCompose> : null}
          </div>
        }
      />
      <nav aria-label="工厂生产视图" className="flex flex-wrap gap-2 text-sm">
        <Link href="/delivery" aria-current="page" className="rounded-full bg-[var(--brand)] px-4 py-2 text-[var(--on-brand)]">生产进度</Link>
        <Link href="/orders?view=orders" className="rounded-full border border-[var(--line)] px-4 py-2">生产订单</Link>
        <Link href="/styles?tab=projects" className="rounded-full border border-[var(--line)] px-4 py-2">工厂打样 →</Link>
      </nav>
      <details className="text-xs text-[var(--ink-muted)]"><summary className="w-fit cursor-pointer">查看统计口径</summary><ul className="mt-2 space-y-1">{board.facts.map(fact=><li key={fact}>{fact}</li>)}</ul></details>
      {transferRecords.length ? <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm">转厂记录 · {transferRecords.length}</summary><div className="mt-3"><FactoryTransferRecords records={transferRecords} /></div></details> : null}
      <div id="board" className="space-y-3">
        <ViewSelect label="查看" value={deliveryHref(view,q)} options={BOARD_VIEWS.map(item=>({href:deliveryHref(item.id,q),label:`${item.label} ${filterProductionRows(board.rows,item.id).length}`}))} />
        <CatalogSearch action="/delivery" q={q} extras={extras} placeholder="订单号、款号、工厂、客户、颜色、异常" />
        <p className="text-xs text-[var(--ink-muted)]">
          {q ? `匹配 ${rows.length} / ${viewed.length} 张` : `本视图 ${rows.length} 张`}
        </p>
      </div>
      <Card className="overflow-x-auto">
        <table className="min-w-[1180px] w-full text-sm">
          <thead className="sticky top-0 z-20 bg-[var(--paper)] text-left">
            <tr>
              <th className="sticky left-0 z-30 min-w-[168px] bg-[var(--paper)] px-4 py-3 shadow-[1px_0_0_var(--line)]">
                订单
              </th>
              <th className="min-w-[132px] py-3">负责人</th>
              <th className="min-w-[168px] py-3">进度</th>
              <th className="py-3">阶段</th>
              <th className="py-3">余货</th>
              <th className="py-3">可发</th>
              <th className="py-3">资料</th>
              <th className="py-3">面料</th>
              <th className="py-3">色卡</th>
              <th className="py-3">投产</th>
              <th className="py-3">合格</th>
              <th className="py-3">发运</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={12}>
                  {q ? `没有匹配「${q}」的生产单` : view === "all" ? "还没有可见订单" : "这个视图没有订单"}
                </td>
              </tr>
            ) : null}
            {groups.map((group) => (
              <GroupRows key={group.factoryName} group={group} />
            ))}
          </tbody>
        </table>
      </Card>
      {rows
        .filter((row) => row.facts.length)
        .map((row) => (
          <p key={`${row.orderId}-facts`} className="text-xs text-[var(--ink-muted)]">
            {row.orderNo}：{row.facts.join(" ")}
          </p>
        ))}
    </div>
  );
}

function GroupRows({ group }: { group: { factoryName: string; rows: ProductionBoardRow[] } }) {
  return (
    <>
      <tr className="border-t border-[var(--line)] bg-[var(--surface)]">
        <td className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-2 text-xs font-medium" colSpan={12}>
          {group.factoryName} · {group.rows.length} 张
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.orderId} className="border-t border-[var(--line)] align-top">
          <td className="sticky left-0 z-10 bg-[var(--paper)] px-4 py-3 shadow-[1px_0_0_var(--line)]">
            <Link href={`/orders/${row.orderId}#order-materials`} className="text-[var(--brand-strong)]">
              {row.orderNo}
            </Link>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{row.styleCodes}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{row.customerName}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ColorSizeDialog row={row} />
              <PackingDialog row={row} />
            </div>
          </td>
          <td className="py-3">
            <p>{row.owners.roles.length ? row.owners.roles.join(" · ") : "未指定"}</p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{row.owners.factoryName}</p>
          </td>
          <td className="py-3 text-xs">{row.progress.label}</td>
          <td className="py-3">
            <Badge tone={row.stage === "leftover_unshipped" ? "warning" : row.stage === "not_started" ? "neutral" : "ok"}>
              {labels.productionStage(row.stage)}
            </Badge>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{labels.readiness(row.readiness)}</p>
          </td>
          <td className="py-3 font-medium">{row.leftover}</td>
          <td className="py-3 text-xs">
            {row.packable}
            {row.occupied ? <p className="text-[var(--ink-muted)]">占用 {row.occupied}</p> : null}
          </td>
          <td className="max-w-[160px] py-3 text-xs text-[var(--warning)]">
            {row.watch.spec.length ? row.watch.spec.join(" · ") : "—"}
          </td>
          <td className="max-w-[160px] py-3 text-xs">
            <Link href={`/orders/${row.orderId}#material-supply`} className={row.watch.fabric.length ? "text-[var(--warning)]" : "text-[var(--ink-muted)]"}>
              {row.watch.fabric.length ? row.watch.fabric.join(" · ") : row.cut.label}
            </Link>
          </td>
          <td className="max-w-[160px] py-3 text-xs text-[var(--warning)]">
            {row.watch.colorCard.length ? row.watch.colorCard.join(" · ") : "—"}
          </td>
          <td className="py-3">{row.started}</td>
          <td className="py-3">{row.good}</td>
          <td className="py-3">{row.shipped}</td>
        </tr>
      ))}
    </>
  );
}
