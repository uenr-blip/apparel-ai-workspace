import { constructionLibrary } from "@/server/services/construction-library";
import { StyleCards } from "./style-cards";
import { MaterialCards } from "./material-cards";
import { TablePhoto } from "@/components/table-photo";
import { FactoryPatternInbox } from "@/components/factory-pattern-inbox";
import { ViewSelect } from "@/components/view-select";
import { BusinessAgentEntry } from "@/components/business-agent-entry";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { Badge, Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CatalogCompose } from "@/components/catalog-compose";
import { CatalogSearch } from "@/components/catalog-search";
import { buildCatalogHref, catalogQuery, matchesCatalogQuery } from "@/lib/catalog-query";
import {
  MATERIAL_KIND_LABEL,
  MATERIAL_KIND_ORDER,
  filterMaterialShelf,
  materialIsUsed,
  materialShelfExtras,
  materialShelfHref,
  parseMaterialKind,
  parseMaterialLayout,
  parseMaterialUsed,
  sortMaterialShelfForFind,
} from "@/lib/material-shelf-query";
import {
  filterStyleCatalog,
  parseStyleLayout,
  parseStyleOrder,
  sortStyleCatalogForFind,
  styleCatalogExtras,
  styleCatalogHref,
  styleHasOrder,
} from "@/lib/style-catalog-query";
import { ReuseSearch } from "@/components/reuse-search";
import { ACTION_TYPES } from "@/lib/constants";
import { canApproveAction } from "@/server/permissions";
import { listMaterialShelf } from "@/server/services/material-shelf";
import { listStyleSummaries } from "@/server/services/style-thread";
import { prisma } from "@/lib/db";
import { CreateStyleForm } from "./create-style-form";
import { CreateMaterialForm } from "./create-material-form";
import { CreateDesignForm } from "./create-design-form";
import { CreateDevelopmentForm } from "./create-development-form";
import { DesignLobby } from "./design-lobby";
import { listDesigners } from "@/server/services/designer";
import { listStyleCatalog } from "@/server/services/style-catalog";
import { listDesignProjects } from "@/server/services/design-studio";

export default async function StylesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; kind?: string; layout?: string; used?: string; ordered?: string; styleId?: string; materialId?: string; intent?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  if (session.role === "factory" && params.tab === "projects") return <FactoryPatternInbox actor={{organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId}}/>;
  const current =
    params.tab === "projects" || params.tab === "reuse" || params.tab === "materials" || params.tab === "design"
      ? params.tab
      : "styles";
  const q = catalogQuery(params.q);
  const kindFilter = parseMaterialKind(params.kind);
  const materialLayout = parseMaterialLayout(params.layout);
  const usedFilter = parseMaterialUsed(params.used);
  const styleLayout = parseStyleLayout(params.layout);
  const styleOrdered = parseStyleOrder(params.ordered);
  const [styles, projects, shelf, designers, catalog, designs, seasons, constructionMaterials] = await Promise.all([
    listStyleSummaries(session.organizationId, { role: session.role, factoryId: session.factoryId }),
    prisma.developmentProject.findMany({
      where: { organizationId: session.organizationId, archivedAt: null, ...(session.role === "factory" ? {patternSamples:{some:{factoryId:session.factoryId || "",issuedAt:{not:null}}}} : {}) },
      include: { candidates: true, style: true },
      orderBy: { createdAt: "desc" },
    }),
    listMaterialShelf(session.organizationId),
    listDesigners(session.organizationId),
    listStyleCatalog(session.organizationId),
    listDesignProjects(session.organizationId),
    prisma.season.findMany({ where: { organizationId: session.organizationId }, select: { id: true, code: true, name: true }, orderBy: { sort: "asc" } }),
    constructionLibrary(session.organizationId),
  ]);
  const matchedStyles = sortStyleCatalogForFind(
    filterStyleCatalog(
      styles.filter((style) =>
        matchesCatalogQuery(q, [
          style.code,
          style.name,
          style.category,
          style.statusLabel,
          ...style.customerBrands,
          ...style.seasonCodes,
          ...style.factoryNames,
          style.designerName,
          style.createdByName,
          style.brandName,
          style.categoryLabel,
          style.typeName,
          style.yearName,
          ...style.orderPos.map((row) => row.orderNo),
          ...style.orderPos.map((row) => row.po),
          ...style.followPos.map((row) => row.po),
        ]),
      ),
      styleOrdered,
    ),
  );
  const orderedCount = styles.filter(styleHasOrder).length;
  const openCount = styles.length - orderedCount;
  const matchedProjects = projects.filter((project) =>
    matchesCatalogQuery(q, [project.code, project.name, project.style?.code, project.style?.name]),
  );
  const extras: Record<string, string> =
    current === "styles"
      ? styleCatalogExtras({ layout: styleLayout, ordered: styleOrdered })
      : current === "materials"
        ? materialShelfExtras({ kind: kindFilter, layout: materialLayout, used: usedFilter })
        : { tab: current };
  const matchedDesigns = designs.filter((item) =>
    matchesCatalogQuery(q, [item.code, item.name, item.styleCode, item.materialCode, item.developmentCode]),
  );
  const kindCounts = Object.fromEntries(
    MATERIAL_KIND_ORDER.map((kind) => [kind, shelf.filter((item) => item.kind === kind).length]),
  ) as Record<(typeof MATERIAL_KIND_ORDER)[number], number>;
  const scopedShelf = filterMaterialShelf(shelf, { kind: kindFilter });
  const usedCount = scopedShelf.filter(materialIsUsed).length;
  const freeCount = scopedShelf.length - usedCount;
  const visibleShelf = filterMaterialShelf(
    shelf.filter((item) =>
      matchesCatalogQuery(q, [
        item.code,
        item.name,
        item.specSummary,
        item.kindLabel,
        item.composition,
        item.gsm,
        item.widthCm,
        ...item.usedByStyleCodes,
        ...item.usedByProjectCodes,
      ]),
    ),
    { kind: kindFilter, used: usedFilter },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={current === "materials" ? "资料与库存" : "款式与开发资料"}
        title={{ styles: "款式档案", projects: "开发打版", materials: "面辅料库", reuse: "历史资料复用", design: "AI设计工作台" }[current]}
        description={
          current === "design"
            ? "打开草案继续设计；新想法从新建设计草案开始。"
            : current === "projects" ? "从新建打版开始，填写版单、留存头版与改版，核对后交给工厂打样。" : current === "materials" ? "看图找面料、纱线和辅料；点图片放大，点详情查看规格与使用记录。" : "看图找款，查款号、季节或 PO；用料与订单都在本款详情里。"
        }
        actions={<>
          {["manager", "salesperson"].includes(session.role) ? <BusinessAgentEntry module="product" /> : null}
          {current === "styles" ? (
            <CatalogCompose label="新建主档" title="新建主档" note="翻单不要复制主档。加色不是新款。设计师在表单里快选，不另开名单按钮。">
              <CreateStyleForm
                canEdit={canApproveAction(session.role, ACTION_TYPES.createStyleMaster)}
                designers={designers.map((item) => ({ id: item.id, name: item.name }))}
                catalog={catalog}
                seasons={seasons}
                materials={constructionMaterials}
              />
            </CatalogCompose>
          ) : current === "materials" ? (
            <CatalogCompose label="新建材料" title="新建材料" note="这是材料主档，不是库存，也不是已采购。">
              <CreateMaterialForm canEdit={canApproveAction(session.role, ACTION_TYPES.createMaterialMaster)} />
            </CatalogCompose>
          ) : current === "projects" ? (
            <CatalogCompose
              label="新建打版"
              title="新建打版"
              note="先建打版记录，再填写版单、参考图和用料。可以暂不填款号，核对留档后再发给工厂。"
            >
              <CreateDevelopmentForm
                canEdit={canApproveAction(session.role, ACTION_TYPES.createDevelopmentProject)}
                styles={styles.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
                materials={shelf.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
              />
            </CatalogCompose>
          ) : current === "design" ? (
            <CatalogCompose
              label="新建设计草案"
              title="AI设计工作台"
              note="不需要正式款号。生成未配置真实模型时会明确失败，不会出假图。"
              defaultOpen={Boolean(params.styleId || params.materialId)}
            >
              <CreateDesignForm
                canEdit={canApproveAction(session.role, ACTION_TYPES.createDesignProject)}
                styles={styles.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
                materials={shelf.map((item) => ({ id: item.id, code: item.code, name: item.name }))}
                presetStyleId={params.styleId ?? ""}
                presetMaterialId={params.materialId ?? ""}
                presetIntent={params.intent ?? "reference"}
              />
            </CatalogCompose>
          ) : null}
        </>}
      />
      <nav aria-label="开发与款式资料" className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--line)] text-sm">
        <Tab href={stylesTabHref("styles", q)} active={current === "styles"}>
          款式 {styles.length}
        </Tab>
        <Tab href={stylesTabHref("design", q)} active={current === "design"}>
          AI设计工作台 {designs.length}
        </Tab>
        <Tab href={stylesTabHref("projects", q)} active={current === "projects"}>
          开发打版 {projects.length}
        </Tab>
        <Tab href={stylesTabHref("materials", q)} active={current === "materials"}>
          面辅料库 {shelf.length}
        </Tab>
        <Tab href={stylesTabHref("reuse", q)} active={current === "reuse"}>
          历史复用
        </Tab>
      </nav>
      {current !== "reuse" ? (
        <>
          <CatalogSearch
            action="/styles"
            q={q}
            extras={extras}
            placeholder={
              current === "materials"
                ? "货号、名称、成分、规格、用在哪款"
                : current === "projects"
                  ? "编号、名称、款号"
                  : current === "design"
                    ? "草案编号、名称、款号、材料"
                    : "款号、款名、品牌、季节、PO、类型、设计师"
            }
          />
          {q ? (
            <p className="text-xs text-[var(--ink-muted)]">
              {current === "materials"
                ? `找到 ${visibleShelf.length} 条`
                : current === "projects"
                  ? `匹配 ${matchedProjects.length} / ${projects.length} 个`
                  : current === "design"
                    ? `匹配 ${matchedDesigns.length} / ${designs.length} 份草案`
                    : `找到 ${matchedStyles.length} 款`}
            </p>
          ) : null}
        </>
      ) : null}
      {current === "styles" ? (
        <div className="space-y-4">
          <details className="text-sm" open={Boolean(styleOrdered)}>
            <summary className="w-fit cursor-pointer text-[var(--ink-muted)]">筛选与显示 · {styleOrdered === "ordered" ? "已有订单" : styleOrdered === "open" ? "尚未接单" : "全部款式"} · {styleLayout === "cards" ? "卡片" : "列表"} · {matchedStyles.length} 款</summary>
            <div className="mt-3 flex flex-wrap gap-4">
              <ViewSelect label="显示方式" value={styleCatalogHref({layout:styleLayout,ordered:styleOrdered},q)} options={[{href:styleCatalogHref({layout:"cards",ordered:styleOrdered},q),label:"卡片认款"},{href:styleCatalogHref({layout:"list",ordered:styleOrdered},q),label:"列表"}]} />
              <ViewSelect label="订单情况" value={styleCatalogHref({layout:styleLayout,ordered:styleOrdered},q)} options={[{href:styleCatalogHref({layout:styleLayout},q),label:`全部 ${styles.length}`},{href:styleCatalogHref({layout:styleLayout,ordered:"ordered"},q),label:`已有订单 ${orderedCount}`},{href:styleCatalogHref({layout:styleLayout,ordered:"open"},q),label:`尚未接单 ${openCount}`}]} />
            </div>
          </details>
          {matchedStyles.length === 0 ? (
            <p className="text-sm text-[var(--ink-muted)]">{q || styleOrdered ? "没有符合条件的款式" : "还没有款式"}</p>
          ) : styleLayout === "list" ? (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-sm">
                  <thead className="bg-[var(--paper)] text-[var(--ink-muted)]">
                    <tr>
                      <th className="px-4 py-2">图</th>
                      <th>款号</th>
                      <th>款名</th>
                      <th>品牌</th>
                      <th>类型</th>
                      <th>订单 PO</th>
                      <th>季节</th>
                      <th>设计师</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedStyles.map((style) => (
                      <tr key={style.id} className="border-t border-[var(--line)]">
                        <td className="px-4 py-2">
                          <Image
                            src={style.imageSrc}
                            alt={`${style.name} 款式图`}
                            width={48}
                            height={48}
                            unoptimized
                            className="h-12 w-12 rounded-lg bg-[var(--paper)] object-cover"
                          />
                        </td>
                        <td className="font-medium">
                          <Link href={`/styles/${style.id}`} className="text-[var(--brand-strong)]">
                            {style.code}
                          </Link>
                        </td>
                        <td>{style.name}</td>
                        <td className="text-[var(--ink-muted)]">{style.brandName ?? "未挂"}</td>
                        <td className="text-[var(--ink-muted)]">{style.typeName ?? "未选"}</td>
                        <td className="text-[var(--ink-muted)]">{formatStyleOrders([...style.orderPos, ...style.followPos])}</td>
                        <td className="text-[var(--ink-muted)]">{style.seasonCodes.length ? style.seasonCodes.join("、") : "未挂"}</td>
                        <td className="text-[var(--ink-muted)]">{style.designerName ?? "未指定"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <StyleCards styles={matchedStyles} canEdit={["manager", "salesperson"].includes(session.role)} />
          )}
        </div>
      ) : null}
      {current === "design" ? (
        q && matchedDesigns.length === 0 ? (
          <p className="text-sm text-[var(--ink-muted)]">没有匹配「{q}」的草案</p>
        ) : (
          <DesignLobby drafts={matchedDesigns} />
        )
      ) : null}
      {current === "projects" ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--paper)] text-left">
              <tr>
                <th className="px-4 py-3">打版记录</th>
                <th>状态</th>
                <th>款号</th>
                <th>版单</th>
                <th>候选引用</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={5}>
                    还没有打版记录。点击页头“新建打版”，填写毛衣、针织或梭织版单，不必先有款号。
                  </td>
                </tr>
              ) : null}
              {projects.length > 0 && matchedProjects.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-[var(--ink-muted)]" colSpan={5}>
                    没有匹配「{q}」的打版记录
                  </td>
                </tr>
              ) : null}
              {matchedProjects.map((project) => (
                <tr key={project.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3">
                    <Link href={`/projects/${project.id}`} className="text-[var(--brand-strong)]">
                      {project.code} {project.name}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={project.styleId ? "ok" : "warning"}>{project.styleId ? "已关联款号" : "进行中"}</Badge>
                  </td>
                  <td>{project.style?.code ?? "尚未关联款号"}</td>
                  <td>{project.craftFamily === "sweater" ? "毛衣" : project.craftFamily === "knit" ? "针织" : project.craftFamily === "woven" ? "梭织" : "还没记"}</td>
                  <td>{project.candidates.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {current === "materials" ? (
        <div className="space-y-4">
          <details className="text-sm" open={Boolean(kindFilter || usedFilter)}>
            <summary className="w-fit cursor-pointer text-[var(--ink-muted)]">筛选与显示 · {kindFilter ? MATERIAL_KIND_LABEL[kindFilter] : "全部材料"} · {usedFilter === "used" ? "已挂款" : usedFilter === "free" ? "尚未挂款" : "不限用途"} · {materialLayout === "cards" ? "卡片" : "列表"} · {visibleShelf.length} 条</summary>
            <div className="mt-3 flex flex-wrap gap-4">
              <ViewSelect label="材料种类" value={materialShelfHref({kind:kindFilter,layout:materialLayout,used:usedFilter},q)} options={[{href:materialShelfHref({layout:materialLayout,used:usedFilter},q),label:`全部 ${shelf.length}`},...MATERIAL_KIND_ORDER.map(kind=>({href:materialShelfHref({kind,layout:materialLayout,used:usedFilter},q),label:`${MATERIAL_KIND_LABEL[kind]} ${kindCounts[kind]}`}))]} />
              <ViewSelect label="显示方式" value={materialShelfHref({kind:kindFilter,layout:materialLayout,used:usedFilter},q)} options={[{href:materialShelfHref({kind:kindFilter,layout:"cards",used:usedFilter},q),label:"卡片认材料"},{href:materialShelfHref({kind:kindFilter,layout:"list",used:usedFilter},q),label:"列表找货号"}]} />
              <ViewSelect label="使用情况" value={materialShelfHref({kind:kindFilter,layout:materialLayout,used:usedFilter},q)} options={[{href:materialShelfHref({kind:kindFilter,layout:materialLayout},q),label:`全部 ${scopedShelf.length}`},{href:materialShelfHref({kind:kindFilter,layout:materialLayout,used:"used"},q),label:`已挂款 ${usedCount}`},{href:materialShelfHref({kind:kindFilter,layout:materialLayout,used:"free"},q),label:`尚未挂款 ${freeCount}`}]} />
            </div>
          </details>
          {MATERIAL_KIND_ORDER.filter((kind) => !kindFilter || kindFilter === kind).map((kind) => {
            const rows = sortMaterialShelfForFind(visibleShelf.filter((item) => item.kind === kind));
            return (
              <div key={kind} className="space-y-3">
                <h3 className="font-medium">{MATERIAL_KIND_LABEL[kind]}</h3>
                {rows.length === 0 ? (
                  <p className="text-sm text-[var(--ink-muted)]">
                    {q || usedFilter
                      ? `没有符合条件的${MATERIAL_KIND_LABEL[kind]}`
                      : `还没有${MATERIAL_KIND_LABEL[kind]}。页头新建，种类选${MATERIAL_KIND_LABEL[kind]}。`}
                  </p>
                ) : materialLayout === "list" ? (
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="bg-[var(--paper)] text-[var(--ink-muted)]">
                          <tr>
                            <th className="px-4 py-2">图</th>
                            <th>货号</th>
                            <th>名称</th>
                            <th>成分</th>
                            <th>克重</th>
                            <th>幅宽</th>
                            <th>用在哪款</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((item) => (
                            <tr key={item.id} className="border-t border-[var(--line)]">
                              <td className="px-4 py-2">
                                {item.imageSrc ? (
                                  <TablePhoto src={item.imageSrc} label={`${item.name}材料图`} compact />
                                ) : (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--paper)] text-[10px] text-[var(--ink-muted)]">
                                    无图
                                  </div>
                                )}
                              </td>
                              <td className="font-medium">
                                <Link href={`/resources/materials/${item.id}`} className="text-[var(--brand-strong)]">
                                  {item.code}
                                </Link>
                              </td>
                              <td>{item.name}</td>
                              <td className="text-[var(--ink-muted)]">{item.composition || "未填"}</td>
                              <td className="text-[var(--ink-muted)]">{item.gsm ? `${item.gsm}g/m²` : "未填"}</td>
                              <td className="text-[var(--ink-muted)]">{item.widthCm ? `${item.widthCm}cm` : "未填"}</td>
                              <td className="text-[var(--ink-muted)]">
                                {item.usedByStyleCodes.length
                                  ? item.usedByStyleCodes.join("、")
                                  : item.usedByProjectCodes.length
                                    ? `开发 ${item.usedByProjectCodes.join("、")}`
                                    : "尚未挂到款上"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ) : (
                  <MaterialCards materials={rows} />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {current === "reuse" ? <ReuseSearch /> : null}
    </div>
  );
}

function formatStyleOrders(orderPos: Array<{ po: string | null }>) {
  if (orderPos.length === 0) return "尚无订单";
  const pos = [...new Set(orderPos.map(row => row.po?.trim()).filter(Boolean))];
  const missing = orderPos.filter(row => !row.po?.trim()).length;
  return [
    pos.slice(0, 2).join("、"),
    pos.length > 2 ? `另有 ${pos.length - 2} 个 PO` : "",
    missing ? `${missing} 条记录 PO 待补` : "",
  ].filter(Boolean).join(" · ");
}

function stylesTabHref(tab: string, q: string) {
  return buildCatalogHref("/styles", tab === "styles" ? {} : { tab }, q);
}

function Tab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "border-b-2 border-[var(--brand)] py-3 font-medium text-[var(--ink)]"
          : "border-b-2 border-transparent py-3 text-[var(--ink-muted)] hover:text-[var(--ink)]"
      }
    >
      {children}
    </Link>
  );
}
