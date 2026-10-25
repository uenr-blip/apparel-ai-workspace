import { BusinessAgentEntry } from "@/components/business-agent-entry";
import { FollowNavigationScope } from "@/components/navigation-scope";
import Image from "next/image";
import Link from "next/link";
import { Library } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { canApproveAction } from "@/server/permissions";
import { labels } from "@/lib/labels";
import { CatalogCompose } from "@/components/catalog-compose";
import { CatalogSearch } from "@/components/catalog-search";
import { catalogQuery, matchesCatalogQuery } from "@/lib/catalog-query";
import { CreateOralOrderForm } from "./create-oral-order-form";
import { CreateFollowSheetForm } from "./create-follow-sheet-form";
import { OrderAssistantForm } from "./order-assistant-form";
import { SeasonBoardView } from "./season-board";
import { listFollowProducts, listSeasonBoard } from "@/server/services/order-merch";
import { FollowProductList } from "./follow-product-list";
import { ACTION_TYPES } from "@/lib/constants";
import { isDeskOrder } from "@/server/domain/desk-orders";
import { listOrderSummaries } from "@/server/services/order-board";
import { listOrgFillCatalog } from "@/server/services/oral-order";
import type { OrderWatch } from "@/server/domain/order-watch";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; all?: string; view?: string; sheet?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const q = catalogQuery(params.q);
  const showAll = params.all === "1";
  const mode = params.view === "orders" ? "orders" : params.view === "season" ? "season" : "follow";
  const canCreate = canApproveAction(session.role, ACTION_TYPES.createOrderDraft);
  const needsOrderForm = mode === "orders" && canCreate;
  const [rows, customers, styles, factories, fillCatalog, seasonBoard, followProducts] = await Promise.all([
    mode === "orders" ? listOrderSummaries(session.organizationId, { role: session.role, factoryId: session.factoryId }) : [],
    needsOrderForm ? prisma.customer.findMany({ where: { organizationId: session.organizationId, archivedAt: null }, orderBy: { name: "asc" } }) : [],
    needsOrderForm ? prisma.style.findMany({ where: { organizationId: session.organizationId, archivedAt: null }, orderBy: { code: "asc" } }) : [],
    needsOrderForm ? prisma.party.findMany({
      where: { organizationId: session.organizationId, kind: "factory", archivedAt: null },
      orderBy: { name: "asc" },
    }) : [],
    needsOrderForm ? listOrgFillCatalog(session.organizationId) : null,
    mode === "season" ? listSeasonBoard(session.organizationId, { role: session.role, factoryId: session.factoryId }) : Promise.resolve(null),
    mode === "follow" ? listFollowProducts(session.organizationId, { role: session.role, factoryId: session.factoryId }) : { sales: [], bulk: [], emptySheets: [] },
  ]);
  const searchable = rows.filter((row) =>
    matchesCatalogQuery(q, [
      row.orderNo,
      row.customerName,
      row.po,
      row.styleCodes,
      row.colors,
      row.factoryName,
      row.delivery,
      row.createdByName,
      ...row.watch.spec,
      ...row.watch.fabric,
      ...row.watch.colorCard,
    ]),
  );
  const hiddenDrafts = searchable.filter((row) => !isDeskOrder(row)).length;
  const matched = q || showAll ? searchable : searchable.filter((row) => isDeskOrder(row));
  const canFollow = canApproveAction(session.role, ACTION_TYPES.createFollowSheet);
  const salesCount = followProducts.sales.length;
  const bulkCount = followProducts.bulk.reduce((count, group) => count + group.styles.length, 0);
  const followSide =
    params.sheet === "sales" || params.sheet === "bulk"
      ? params.sheet
      : salesCount > 0 && bulkCount === 0
        ? "sales"
        : bulkCount > 0 && salesCount === 0
          ? "bulk"
          : "sales";
  const chip = (active: boolean) =>
    active
      ? "rounded-full bg-[var(--brand)] px-4 py-2 text-white"
      : "rounded-full border border-[var(--line)] px-4 py-2";

  return (
    <div className="space-y-7">
      {mode === "follow" ? <FollowNavigationScope kind={followSide} /> : null}
      <PageHeader
        eyebrow={mode === "orders" ? "工厂生产" : "客户下单与跟进"}
        title={mode === "orders" ? "生产订单" : mode === "season" ? "本季用料汇总" : followSide === "bulk" ? "大货跟单" : "销售样"}
        description={
          mode === "orders"
            ? "点订单号，打开这一张生产订单。"
            : mode === "season"
              ? "这一季各厂做了哪些款，要买多少。"
              : followSide === "bulk"
              ? "按季节和工厂看大货总表。点图片放大，点品名、产品编号或 PO 打开本款资料。"
              : "销售样一款一行。点图片放大，点品名或产品编号核对资料，确认后交接大货。"
        }
        actions={
          mode === "orders" ? (
            canCreate ? (
              <>
              <CatalogCompose assistant label="问衣据" title="问衣据 · 生产建单" note="这里准备生产订单草稿。销售样或大货跟单，请到跟单页处理。">
                <OrderAssistantForm />
              </CatalogCompose>
              <CatalogCompose label="新建生产订单" title="手动新建生产订单" note="现场或电话记下的单。客户邮件请去客户来单粘贴。">
                <CreateOralOrderForm
                  customers={customers.map((item) => ({ id: item.id, label: item.name }))}
                  styles={styles.map((item) => ({ id: item.id, label: `${item.code} ${item.name}` }))}
                  factories={factories.map((item) => ({ id: item.id, label: item.name }))}
                  fillPacks={fillCatalog?.packs ?? {}}
                />
              </CatalogCompose>
              </>
            ) : (
              <p className="max-w-xs text-right text-sm leading-6 text-[var(--ink-muted)]">当前角色不能建单。</p>
            )
          ) : canFollow ? (
            <>
            <BusinessAgentEntry module="follow" />
            <CatalogCompose label="新建跟单" title="新建跟单" note="先选销售样或大货。一张跟单里再加很多款。">
              <CreateFollowSheetForm />
            </CatalogCompose>
            </>
          ) : null
        }
      />
      {mode === "orders" ? <nav className="flex flex-wrap gap-2 text-sm" aria-label="工厂生产视图"><Link href="/delivery" className={chip(false)}>生产进度</Link><Link href="/orders?view=orders" aria-current="page" className={chip(true)}>生产订单</Link><Link href="/orders?sheet=bulk" className={chip(false)}>大货总表 →</Link></nav> : null}
      {mode === "season" && seasonBoard ? (
        <Card className="sheet-pad">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-medium">本季要买多少</h2>
            <Link href="/orders" className="text-sm text-[var(--brand-strong)]">
              返回跟单
            </Link>
          </div>
          <SeasonBoardView board={seasonBoard} />
        </Card>
      ) : null}
      {mode === "follow" ? (
        <Card className="sheet-pad">
          <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="销售样、大货与面辅料库">
            <Link href="/orders?sheet=sales" className={chip(followSide === "sales")}>
              销售样{salesCount ? ` ${salesCount}` : ""}
            </Link>
            <Link href="/orders?sheet=bulk" className={chip(followSide === "bulk")}>
              大货总表{bulkCount ? ` ${bulkCount}` : ""}
            </Link>
            {session.role !== "factory" ? <Link href="/styles?tab=materials" prefetch={false} className={`${chip(false)} inline-flex items-center gap-2 text-[var(--brand-strong)]`} title="打开共用的面料、辅料与纱线资料库">
              <Library size={15} strokeWidth={1.6} aria-hidden="true" />面辅料库
            </Link> : null}
          </nav>
          <FollowProductList viewerKey={`${session.organizationId}:${session.id}`} key={followSide} lists={followProducts} side={followSide} />
          <p className="mt-4 text-sm">
            <Link href="/orders?view=season" className="text-[var(--brand-strong)]">
              看本季要买多少
            </Link>
          </p>
        </Card>
      ) : null}
      {mode === "orders" ? (
      <>
      <Card className="sheet-pad">
        <CatalogSearch
          action="/orders"
          q={q}
          placeholder="订单号、款号、客户、PO、颜色、工厂、建单人、缺资料"
          extras={{ view: "orders", ...(showAll ? { all: "1" } : {}) }}
        />
        <p className="mt-4 text-xs leading-6 text-[var(--ink-muted)]">
          {q
            ? `匹配 ${matched.length} / ${rows.length} 张`
            : showAll
              ? `全部 ${matched.length} 张，含开发草稿`
              : `一线台面 ${matched.length} 张`}
          {!q && hiddenDrafts ? (
            <>
              {" · "}
              {showAll ? (
                <Link href="/orders?view=orders" className="text-[var(--brand-strong)]">
                  只看可操作单
                </Link>
              ) : (
                <Link href="/orders?view=orders&all=1" className="text-[var(--brand-strong)]">
                  另有 {hiddenDrafts} 张开发草稿
                </Link>
              )}
            </>
          ) : null}
        </p>
      </Card>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="sheet-table min-w-[1080px] text-sm leading-6">
            <thead>
              <tr>
                <th>款图</th>
                <th>订单</th>
                <th>客户</th>
                <th>款 / 颜色</th>
                <th>数量</th>
                <th>PO</th>
                <th>工厂</th>
                <th>建单</th>
                <th>交期</th>
                <th>缺什么</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {matched.length === 0 ? (
                <tr>
                  <td className="text-[var(--ink-muted)]" colSpan={11}>
                    {q ? `没有匹配「${q}」的订单` : hiddenDrafts ? "一线台面暂无单。开发草稿已藏起。" : "还没有订单"}
                  </td>
                </tr>
              ) : null}
              {matched.map((order) => (
                <tr key={order.id}>
                  <td>
                    {order.imageSrc ? (
                      <Image
                        src={order.imageSrc}
                        alt={`${order.styleCodes} 款式图`}
                        width={88}
                        height={66}
                        unoptimized
                        className="h-[66px] w-[88px] rounded-xl object-cover bg-[var(--paper)]"
                      />
                    ) : (
                      <span className="text-xs text-[var(--ink-muted)]">无图</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/orders/${order.id}`}
                      className="font-[family-name:var(--font-display)] text-base tracking-[0.02em] text-[var(--brand-strong)]"
                    >
                      {order.orderNo}
                    </Link>
                  </td>
                  <td>{order.customerName}</td>
                  <td>
                    <div>{order.styleCodes}</div>
                    <div className="text-xs leading-5 text-[var(--ink-muted)]">{order.colors}</div>
                  </td>
                  <td className="tabular-nums">{order.quantity}</td>
                  <td>{order.po}</td>
                  <td>{order.factoryName}</td>
                  <td>{order.createdByName}</td>
                  <td>{order.delivery}</td>
                  <td className="max-w-[220px] text-xs leading-5 text-[var(--warning)]">{formatWatch(order.watch)}</td>
                  <td>
                    <Badge tone={order.readiness.includes("blocked") ? "warning" : "neutral"}>
                      {labels.orderStatus(order.status)} · {labels.readiness(order.readiness)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      ) : null}
    </div>
  );
}

function formatWatch(watch: OrderWatch) {
  const parts = [...watch.spec, ...watch.fabric, ...watch.colorCard];
  return parts.length ? parts.join(" · ") : "未卡住";
}
