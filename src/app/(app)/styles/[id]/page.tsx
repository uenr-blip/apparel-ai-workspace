import { constructionLibrary } from "@/server/services/construction-library";
import { CatalogCompose } from "@/components/catalog-compose";
import { CreateFollowSheetForm } from "../../orders/create-follow-sheet-form";
import { listStyleFollowLinks } from "@/server/services/style-follow-links";
import { StyleConstructionPanel } from "../style-construction-panel";
import { StyleConstructionSummary } from "../style-construction-fields";
import { constructionRows, constructionStamp } from "@/server/services/style-construction";
import { constructionPublic } from "@/lib/style-construction";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { Badge, Card } from "@/components/ui/card";
import { canApproveAction } from "@/server/permissions";
import { listMaterialShelf } from "@/server/services/material-shelf";
import { getStyleThread, StyleThreadError } from "@/server/services/style-thread";
import { BOM_CONSUMPTION_PENDING } from "@/server/services/style-bom";
import { StyleBomDraftForm } from "../style-bom-form";
import { StyleSeasonForm } from "../style-season-form";
import { StyleImageForm } from "../style-image-form";
import { StyleProcessForm } from "../style-process-form";
import { StyleDesignerForm } from "../style-designer-form";
import { StyleCatalogForm } from "../style-catalog-form";

export default async function StyleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  let thread;
  try {
    thread = await getStyleThread(session.organizationId, id);
  } catch (error) {
    if (error instanceof StyleThreadError) notFound();
    throw error;
  }

  const [shelf, versions, follows, constructionMaterials] = await Promise.all([
    listMaterialShelf(session.organizationId),
    prisma.styleVersion.findMany({
      where: { styleId: thread.style.id },
      include: { bomLines: { include: { material: true }, orderBy: { materialId: "asc" } }, attachments: true },
      orderBy: { versionNumber: "desc" },
    }),
    listStyleFollowLinks(session.organizationId, { role: session.role, factoryId: session.factoryId }),
    constructionLibrary(session.organizationId),
  ]);
  const followRows = follows.get(id) ?? [];
  const productionRows = thread.identifiers.customerPos.filter(row => !followRows.some(follow => follow.productionOrderId && row.href === `/orders/${follow.productionOrderId}`));
  const handoffs = await prisma.patternHandoff.findMany({ where: { organizationId: session.organizationId, styleVersionId: { in: versions.map(v => v.id) } }, include: { project: { select: { code: true } } }, orderBy: { createdAt: "desc" } });
  const latestDraft = versions.find((version) => version.status !== "approved");
  const latestApproved = versions.find((version) => version.status === "approved");
  const sourceVersion = latestDraft ?? latestApproved;
  const sourceBom = (sourceVersion?.bomLines ?? []).filter(line => line.material.organizationId === session.organizationId);
  const construction = constructionPublic(constructionRows(sourceVersion));
  const constructionHistory = await prisma.auditEvent.findMany({ where: { organizationId: session.organizationId, OR: [{ entityId: id, action: "style.master.created" }, { entityId: { in: versions.map(v => v.id) }, action: "style.construction.saved" }] }, orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { name: true } } } });
  const initialSelectedIds = sourceBom.map((line) => line.materialId);
  const initialConsumptions = Object.fromEntries(
    sourceBom.map((line) => [line.materialId, line.consumption === BOM_CONSUMPTION_PENDING ? "" : line.consumption]),
  );

  return (
    <div className="space-y-4">
      {handoffs.length ? <details className="rounded-xl border border-[var(--line)] p-4"><summary className="cursor-pointer text-sm">正式资料的回样交接依据</summary><ul className="mt-3 space-y-2 text-sm">{handoffs.map(h => { const snapshot = JSON.parse(h.snapshotJson); const version = versions.find(v => v.id === h.styleVersionId); return <li key={h.id}><Link className="underline" href={`/projects/${h.projectId}`}>{h.project.code} · {snapshot.factoryName} · 版单 V{snapshot.revisionNumber} 第{snapshot.round}轮</Link> → 资料 V{version?.versionNumber} · {version?.status === "approved" ? "已批准" : "待核对"} · {snapshot.createdByName}</li>; })}</ul></details> : null}
      <Card className="grid gap-4 p-5 md:grid-cols-[240px_1fr]">
        <div>
          <Image
            src={thread.style.imageSrc}
            alt={`${thread.style.name} 款式图`}
            width={480}
            height={320}
            unoptimized
            className="h-56 w-full rounded-lg object-contain bg-[var(--paper)]"
          />
          <StyleImageForm styleId={thread.style.id} canEdit={session.role !== "factory"} />
        </div>
        <div>
          <p className="text-sm text-[var(--ink-muted)]">款式主档</p>
          <h2 className="font-[family-name:var(--font-display)] text-3xl">{thread.style.name}</h2>
          {["manager", "salesperson"].includes(session.role) ? <Link className="mt-2 inline-block text-sm underline" href={`/resources/catalog?kind=style&id=${thread.style.id}`}>修改品名、款号 / 归档</Link> : null}
          <p className="mt-2 text-sm">
            {thread.style.category} · {thread.style.silhouette}
          </p>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">{thread.style.demoNote}</p>
          {session.role !== "factory" ? (
            <p className="mt-3 text-sm">
              <Link href={`/styles?tab=design&styleId=${thread.style.id}`} className="text-[var(--brand-strong)]">
                用这款做设计
              </Link>
            </p>
          ) : null}
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">款号</dt>
              <dd className="font-medium">{thread.identifiers.styleCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">季节</dt>
              <dd>
                {thread.identifiers.seasons.length === 0
                  ? "未挂季节"
                  : thread.identifiers.seasons.map((season) => `${season.code} ${season.name}`).join("、")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">品牌</dt>
              <dd>{thread.identifiers.brand?.name ?? "未挂"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">品类</dt>
              <dd>{thread.identifiers.category?.label ?? thread.style.category}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">类型</dt>
              <dd>{thread.identifiers.type?.name ?? "未选"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">开发年份</dt>
              <dd>{thread.identifiers.year?.name ?? "未选"} · 不是款号</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">设计师</dt>
              <dd>{thread.identifiers.designer?.name ?? "未指定"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-muted)]">建档</dt>
              <dd>{thread.identifiers.createdByName ?? "未记"}</dd>
            </div>
          </dl>
          <details id="style-info-edit" className="mt-4 scroll-mt-24 rounded-xl border border-[var(--line)] p-3">
            <summary className="cursor-pointer text-sm font-medium">修改品牌、季节、类型与署名</summary>
            <div className="mt-3 space-y-3">
            <StyleCatalogForm
              styleId={thread.style.id}
              catalog={thread.identifiers.catalog}
              current={{
                brandOptionId: thread.identifiers.brand?.id ?? "",
                categoryOptionId: thread.identifiers.category?.id ?? "",
                typeOptionId: thread.identifiers.type?.id ?? "",
                yearOptionId: thread.identifiers.year?.id ?? "",
              }}
              canEdit={session.role !== "factory"}
            />
            <StyleDesignerForm
              styleId={thread.style.id}
              currentId={thread.identifiers.designer?.id ?? null}
              designers={thread.identifiers.availableDesigners}
              canEdit={session.role !== "factory"}
            />
            <StyleSeasonForm
              styleId={thread.style.id}
              linkedCodes={thread.identifiers.seasons.map((season) => season.code)}
              availableSeasons={thread.identifiers.availableSeasons}
              canEdit={session.role !== "factory"}
            />
            </div>
          </details>
          {thread.openBlockers.length ? (
            <p className="mt-3 text-sm text-[var(--danger)]">当前卡住：{thread.openBlockers.join("、")}</p>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">这条链上没有未关闭的阻塞任务。</p>
          )}
        </div>
      </Card>

      <Card id="style-materials" className="scroll-mt-24 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-medium">本款用料 · 面料 / 纱线 / 辅料</h3>
          <span className="text-xs text-[var(--ink-muted)]">{sourceVersion ? `资料 V${sourceVersion.versionNumber} · ${sourceVersion.status === "approved" ? "已批准" : "待核对草稿"}` : "尚无资料"}</span>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">面料与纱线按实际选料分项记录；下方为本版用料，订单用料以各订单指定的资料版本为准。</p>
        <StyleConstructionPanel materials={constructionMaterials} key={constructionStamp(sourceVersion)} rows={construction} styleId={id} versionId={sourceVersion?.id ?? ""} expectedStamp={constructionStamp(sourceVersion)} canEdit={canApproveAction(session.role, ACTION_TYPES.saveStyleBomDraft)} />
        {versions.filter(v => v.id !== sourceVersion?.id && v.constructionJson !== "[]").length ? <details className="mt-4 border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm">查看历史版本用料与工艺</summary>{versions.filter(v => v.id !== sourceVersion?.id && v.constructionJson !== "[]").map(v => <details key={v.id} className="mt-3"><summary className="cursor-pointer text-sm">资料 V{v.versionNumber} · {v.status === "approved" ? "已批准" : "草稿"}</summary><StyleConstructionSummary rows={constructionPublic(constructionRows(v))} styleId={id} versionId={v.id} /></details>)}</details> : null}
        {constructionHistory.length ? <details className="mt-4 border-t border-[var(--line)] pt-3"><summary className="cursor-pointer text-sm">用料与工艺修改记录</summary><ul className="mt-3 space-y-3 text-sm">{constructionHistory.map(event => {
          const payload = JSON.parse(event.payloadJson || "{}");
          const before = Array.isArray(payload.before) ? payload.before : [];
          const after = Array.isArray(payload.after) ? payload.after : payload.after?.construction || [];
          const removed = before.filter((r: { key: string }) => !after.some((a: { key: string }) => a.key === r.key));
          const changed = after.filter((r: { key: string }) => JSON.stringify(r) !== JSON.stringify(before.find((b: { key: string }) => b.key === r.key)));
          return <li key={event.id}><p>{event.actor?.name || "历史用户"} · {new Date(event.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · {event.summary}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{changed.length ? `新增或修改：${changed.map((r: { name: string }) => r.name).join("、")}` : "无项目变更"}{removed.length ? `；移除：${removed.map((r: { name: string }) => r.name).join("、")}` : ""}</p></li>;
        })}</ul></details> : null}
        {canApproveAction(session.role, ACTION_TYPES.saveStyleBomDraft) ? <details className="mt-4 border-t border-[var(--line)] pt-3">
          <summary className="w-fit cursor-pointer text-sm text-[var(--brand-strong)]">从材料库选择 / 调整引用</summary>
          <div className="mt-4"><StyleBomDraftForm
            key={sourceVersion?.id}
            styleId={thread.style.id} materials={shelf}
            initialSelectedIds={initialSelectedIds} initialConsumptions={initialConsumptions}
            canEdit={true}
          /></div>
        </details> : null}
      </Card>

      <Card id="style-orders" className="scroll-mt-24 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-medium">订单 PO · 按批次记录</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">同一款可以有多个 PO。已有批次点进原跟单补充，翻单登记新的批次。</p></div>
          {canApproveAction(session.role, ACTION_TYPES.createFollowSheet) ? <CatalogCompose label="登记新 PO" title="为这款登记订单 PO" variant="outline">
            <CreateFollowSheetForm sourceStyle={{ id, code: thread.style.code, name: thread.style.name, seasonCode: thread.identifiers.seasons.length === 1 ? thread.identifiers.seasons[0].code : "" }} />
          </CatalogCompose> : null}
        </div>
        {followRows.length || productionRows.length ? <ul className="mt-3 divide-y divide-[var(--line)] text-sm">
          {followRows.map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><strong>{row.po || "PO 待补"}</strong><p className="mt-1 text-xs text-[var(--ink-muted)]">{[row.kindLabel, row.seasonCode, row.title].filter(Boolean).join(" · ")} · {row.productionOrderId ? "已开生产订单" : row.productionLinkPending ? "历史跟单，生产关联待核对" : "跟单草稿"}</p></div>
            <Link href={row.href} className="text-[var(--brand-strong)] underline">{row.productionOrderId ? "查看跟单 / 改单" : row.productionLinkPending ? "打开跟单核对" : "填写 / 修改 PO"}</Link>
          </li>)}
          {productionRows.map(row => <li key={row.href} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><strong>{row.po || "PO 待补"}</strong><p className="mt-1 text-xs text-[var(--ink-muted)]">生产订单 {row.orderNo}</p></div>
            <Link href={row.href} className="text-[var(--brand-strong)] underline">打开订单资料</Link>
          </li>)}
        </ul> : <p className="mt-3 text-sm text-[var(--ink-muted)]">这款还没有订单 PO，可从“登记新 PO”开始填写跟单。</p>}
      </Card>

      <Card className="p-5">
        <h3 className="font-medium">色路</h3>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">加色仍是这一款，要色样确认，不是新设计号。图片识别不能替代终审。</p>
        {thread.colorways.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-muted)]">还没有订单颜色。</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {thread.colorways.map((row) => (
              <li key={row.colorName} className="rounded-lg bg-[var(--paper)] p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.colorName}</span>
                  <Badge tone={row.latestLabel === "已批准" ? "ok" : row.latestLabel.includes("退回") ? "danger" : "warning"}>
                    {row.latestLabel}
                  </Badge>
                  <Badge tone="neutral">不是新款</Badge>
                </div>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  出现在 {row.orderNos.slice(0, 3).join("、")}
                  {row.orderNos.length > 3 ? ` · 另有 ${row.orderNos.length - 3} 张` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-medium">从开发到出货</h3>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">样衣订单和生产订单都挂在这一款上。不要去别的菜单找同一件衣服。</p>
        <ol className="mt-4 space-y-0">
          {thread.stages.map((stage, index) => (
            <li key={stage.id} className="relative flex gap-3 pb-5 last:pb-0">
              <div className="flex w-4 flex-col items-center">
                <span
                  className={`mt-1 h-3 w-3 rounded-full ${
                    stage.tone === "ok"
                      ? "bg-[var(--ok)]"
                      : stage.tone === "warning"
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--ink-muted)]"
                  }`}
                />
                {index < thread.stages.length - 1 ? <span className="mt-1 w-px flex-1 bg-[var(--line)]" /> : null}
              </div>
              <div className="min-w-0 flex-1 rounded-lg border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{stage.title}</span>
                  <Badge tone={stage.tone === "ok" ? "ok" : stage.tone === "warning" ? "warning" : "neutral"}>
                    {stage.statusLabel}
                  </Badge>
                  {stage.href ? (
                    <Link href={stage.href} className="text-sm text-[var(--brand-strong)]">
                      打开
                    </Link>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-[var(--ink-muted)]">
                  {stage.facts.map((fact, factIndex) => (
                    <li key={`${stage.id}-${factIndex}`}>{fact}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="p-5">
        <StyleProcessForm
          styleId={thread.style.id}
          processNotes={(latestDraft ?? latestApproved)?.processNotes ?? ""}
          patternRevision={(latestDraft ?? latestApproved)?.patternRevision ?? ""}
          attachments={((latestDraft ?? latestApproved)?.attachments ?? [])
            .filter((item) => item.kind === "pattern")
            .map((item) => ({
              id: item.id,
              fileName: item.fileName,
              href: `/api/styles/${thread.style.id}/pattern/${item.id}`,
            }))}
          canEdit={canApproveAction(session.role, ACTION_TYPES.saveStyleProcessDraft)}
        />
      </Card>


    </div>
  );
}
