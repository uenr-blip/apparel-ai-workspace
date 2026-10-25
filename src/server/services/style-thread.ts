import { prisma } from "@/lib/db";
import { listStyleFollowLinks } from "./style-follow-links";
import { labels } from "@/lib/labels";
import { styleImageSrc } from "@/lib/style-image";
import { aggregateMaterialPlan } from "@/server/services/material-plan";
import { colorConfirmationFacts } from "@/server/services/color-confirm";
import { isRecordedConsumption } from "@/server/services/style-bom";
import { categoryOptionLabel, listStyleCatalog, type StyleCatalog } from "@/server/services/style-catalog";

export class StyleThreadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleThreadError";
  }
}

export type StyleThreadRole = "sales_sample" | "bulk" | "reorder" | "development";

export type StyleThreadStage = {
  id: string;
  kind: "development" | "style_master" | "spec_version" | "order";
  role: StyleThreadRole | null;
  title: string;
  statusLabel: string;
  tone: "ok" | "warning" | "muted";
  href: string | null;
  facts: string[];
};

export type StyleColorway = {
  colorName: string;
  orderNos: string[];
  latestLabel: string;
  notNewStyle: true;
};

export type StyleThread = {
  style: {
    id: string;
    code: string;
    name: string;
    category: string;
    silhouette: string;
    imagePath: string;
    imageSrc: string;
    demoNote: string;
  };
  identifiers: {
    styleCode: string;
    bulkCodeUnverified: true;
    seasons: Array<{ id: string; code: string; name: string }>;
    availableSeasons: Array<{ id: string; code: string; name: string }>;
    customerBrands: string[];
    customerPos: Array<{ orderNo: string; po: string | null; href: string }>;
    designer: { id: string; name: string } | null;
    availableDesigners: Array<{ id: string; name: string }>;
    createdByName: string | null;
    brand: { id: string; name: string } | null;
    category: { id: string; name: string; label: string } | null;
    type: { id: string; name: string } | null;
    year: { id: string; name: string } | null;
    catalog: StyleCatalog;
  };
  colorways: StyleColorway[];
  stages: StyleThreadStage[];
  openBlockers: string[];
};

type OrderWithLine = {
  id: string;
  orderNo: string;
  status: string;
  productionReadiness: string;
  externalCustomerPo: string | null;
  requestedDeliveryDate: string | null;
  requestedDeliveryText: string | null;
  createdAt: Date;
  customer: { name: string };
  colors: string[];
  lines: Array<{ totalQuantity: number; styleId: string; styleVersionId: string | null }>;
};

function orderRole(order: OrderWithLine, all: OrderWithLine[]): StyleThreadRole {
  if (order.productionReadiness === "sales_sample") return "sales_sample";
  if (order.productionReadiness === "development") return "development";
  if (order.status === "completed" || order.productionReadiness === "shipped") return "bulk";
  const hasCompletedBulk = all.some(
    (item) =>
      item.id !== order.id &&
      item.productionReadiness !== "sales_sample" &&
      (item.status === "completed" || item.productionReadiness === "shipped"),
  );
  return hasCompletedBulk ? "reorder" : "bulk";
}

function orderTitle(role: StyleThreadRole) {
  if (role === "sales_sample") return "销售样";
  if (role === "development") return "开发订单";
  if (role === "reorder") return "翻单";
  return "大货";
}

function orderTone(order: OrderWithLine, role: StyleThreadRole, hasBlocker: boolean): StyleThreadStage["tone"] {
  if (hasBlocker) return "warning";
  if (role === "sales_sample" || role === "development") return "muted";
  if (order.status === "completed" || order.productionReadiness === "shipped") return "ok";
  if (
    order.productionReadiness.startsWith("blocked") ||
    order.productionReadiness === "blocked_incomplete_spec"
  ) {
    return "warning";
  }
  return "muted";
}

function buildColorways(
  orders: OrderWithLine[],
  records: Array<{ colorName: string; round: number; status: string }>,
): StyleColorway[] {
  const orderNosByColor = new Map<string, string[]>();
  for (const order of orders) {
    for (const colorName of order.colors) {
      const current = orderNosByColor.get(colorName) ?? [];
      if (!current.includes(order.orderNo)) current.push(order.orderNo);
      orderNosByColor.set(colorName, current);
    }
  }
  return [...orderNosByColor.entries()].map(([colorName, orderNos]) => {
    const latest = [...records.filter((row) => row.colorName === colorName)].sort((left, right) => left.round - right.round).at(-1);
    const latestLabel = !latest
      ? "尚未确认"
      : latest.status === "rejected"
        ? `第 ${latest.round} 轮退回`
        : "已批准";
    return { colorName, orderNos, latestLabel, notNewStyle: true as const };
  });
}

export async function getStyleThread(organizationId: string, styleId: string): Promise<StyleThread> {
  const style = await prisma.style.findFirst({
    where: { id: styleId, organizationId },
    include: {
      versions: { orderBy: { versionNumber: "asc" }, include: { bomLines: { include: { material: true } }, attachments: true } },
      orderLines: {
        include: {
          order: { include: { customer: true } },
          colors: true,
        },
      },
      tasks: true,
      developmentProjects: {
        include: { candidates: { include: { material: true } } },
        orderBy: { createdAt: "asc" },
      },
      seasonLinks: { include: { season: true } },
      designer: true,
      createdBy: true,
      brandOption: true,
      categoryOption: { include: { parent: true } },
      typeOption: true,
      yearOption: true,
    },
  });
  if (!style) throw new StyleThreadError("款式不存在或不属于当前组织");

  const ordersById = new Map<string, OrderWithLine>();
  for (const line of style.orderLines) {
    const existing = ordersById.get(line.order.id);
    if (existing) {
      existing.lines.push({ totalQuantity: line.totalQuantity, styleId: line.styleId, styleVersionId: line.styleVersionId });
      for (const color of line.colors) {
        if (!existing.colors.includes(color.colorName)) existing.colors.push(color.colorName);
      }
      continue;
    }
    ordersById.set(line.order.id, {
      id: line.order.id,
      orderNo: line.order.orderNo,
      status: line.order.status,
      productionReadiness: line.order.productionReadiness,
      externalCustomerPo: line.order.externalCustomerPo,
      requestedDeliveryDate: line.order.requestedDeliveryDate,
      requestedDeliveryText: line.order.requestedDeliveryText,
      createdAt: line.order.createdAt,
      customer: { name: line.order.customer.name },
      colors: line.colors.map((color) => color.colorName),
      lines: [{ totalQuantity: line.totalQuantity, styleId: line.styleId, styleVersionId: line.styleVersionId }],
    });
  }
  const orders = [...ordersById.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const orderIds = orders.map((row) => row.id);

  const relatedTasks = await prisma.taskItem.findMany({
    where: {
      organizationId,
      status: "open",
      OR: [{ relatedStyleId: style.id }, ...(orderIds.length ? [{ relatedOrderId: { in: orderIds } }] : [])],
    },
    orderBy: { createdAt: "asc" },
  });
  const [confirmationRows, orgSeasons, orgDesigners, catalog] = await Promise.all([
    orderIds.length
      ? prisma.confirmationRecord.findMany({
          where: { orderId: { in: orderIds } },
          orderBy: [{ round: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([]),
    prisma.season.findMany({ where: { organizationId }, orderBy: { sort: "asc" } }),
    prisma.designer.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    listStyleCatalog(organizationId),
  ]);

  const openBlockers = [...new Set(relatedTasks.filter((task) => task.blocking).map((task) => labels.taskKind(task.kind)))];

  const stages: StyleThreadStage[] = [];

  for (const project of style.developmentProjects) {
    const materialCodes = project.candidates
      .map((row) => row.material?.code)
      .filter((code): code is string => Boolean(code));
    stages.push({
      id: project.id,
      kind: "development",
      role: null,
      title: "材料开发",
      statusLabel: labels.projectStatus(project.status),
      tone: project.styleId ? "ok" : "warning",
      href: `/projects/${project.id}`,
      facts: [
        `${project.code} ${project.name}`,
        materialCodes.length ? `引用 ${materialCodes.join("、")}，不复制材料主档` : "尚未引用材料",
        project.styleId ? `已关联 ${style.code}，未新建款号` : "尚未关联款号",
      ],
    });
  }

  stages.push({
    id: style.id,
    kind: "style_master",
    role: null,
    title: "款式主档",
    statusLabel: labels.styleStatus(style.status),
    tone: "ok",
    href: null,
    facts: [
      `款号 ${style.code}`,
      style.designer ? `设计师 ${style.designer.name}` : "设计师未指定",
      style.createdBy ? `建档 ${style.createdBy.name}` : "建档人未记",
      "翻单不复制主档和照片",
      "加色不是新款",
      `${style.category} · ${style.silhouette}`,
    ],
  });

  const approvedVersions = style.versions.filter((version) => version.status === "approved");
  const draftVersions = style.versions.filter((version) => version.status !== "approved");
  const approvedToShow =
    approvedVersions.length <= 2
      ? approvedVersions
      : [approvedVersions[0]!, approvedVersions[approvedVersions.length - 1]!];
  const hiddenApproved = Math.max(0, approvedVersions.length - approvedToShow.length);
  const versionsToShow = [...approvedToShow, ...(draftVersions.length ? [draftVersions[draftVersions.length - 1]!] : [])];

  for (const version of versionsToShow) {
    const bomCount = version.bomLines.length;
    const materialCodes = [...new Set(version.bomLines.map((line) => line.material.code))];
    const pendingConsumption = version.bomLines.some((line) => !isRecordedConsumption(line.consumption));
    const oralLines = version.bomLines.filter((line) => isRecordedConsumption(line.consumption) && !line.confirmed);
    const hiddenDrafts = version.status !== "approved" && draftVersions.length > 1 ? draftVersions.length - 1 : 0;
    const hiddenApprovedNote =
      version.status === "approved" &&
      hiddenApproved &&
      version.id === approvedToShow[approvedToShow.length - 1]?.id
        ? [`另有 ${hiddenApproved} 个已批准版本未展开`]
        : [];
    stages.push({
      id: version.id,
      kind: "spec_version",
      role: null,
      title: `资料 第 ${version.versionNumber} 版`,
      statusLabel: version.status === "approved" ? "已批准" : "草稿",
      tone: version.status === "approved" ? "ok" : "warning",
      href: null,
      facts: [
        `面辅料 ${bomCount} 行`,
        ...(bomCount === 0 ? ["建档时尚未写入面辅料"] : [materialCodes.join("、")]),
        ...(pendingConsumption && bomCount > 0 ? ["用量待工厂确认"] : []),
        ...oralLines.map((line) => `${line.material.code} 单耗 ${line.consumption} ${line.unit}（口头）`),
        version.cuffType ? `袖口 ${version.cuffType}` : "袖口未记录",
        version.processNotes.trim() ? "工艺说明已记，不是标准工时" : "未记工艺说明，不能当生产依据",
        version.patternRevision.trim() ? `版次 ${version.patternRevision}` : "未标版次",
        version.attachments.some((item) => item.kind === "pattern")
          ? `版次附件 ${version.attachments.filter((item) => item.kind === "pattern").length} 个，不是制版系统`
          : "未附版次文件，不是制版系统",
        version.status === "draft" ? "不得作为正式生产依据" : "已批准，仅作为该版本快照",
        ...(version.specNotes ? [`规格 ${version.specNotes}`] : []),
        ...(hiddenDrafts ? [`另有 ${hiddenDrafts} 个资料草稿未展开`] : []),
        ...hiddenApprovedNote,
      ],
    });
  }

  const classified = orders.map((order) => ({ order, role: orderRole(order, orders) }));
  const shownOrders: typeof classified = [];
  const salesSamples = classified.filter((row) => row.role === "sales_sample");
  const developmentOrders = classified.filter((row) => row.role === "development");
  const bulks = classified.filter((row) => row.role === "bulk");
  const reorders = classified.filter((row) => row.role === "reorder");
  shownOrders.push(...developmentOrders, ...salesSamples, ...bulks);
  if (reorders.length) shownOrders.push(reorders[reorders.length - 1]!);
  const hiddenReorders = Math.max(0, reorders.length - (reorders.length ? 1 : 0));

  const orderStages: StyleThreadStage[] = shownOrders.map(({ order, role }) => {
    const qty = order.lines.reduce((sum, line) => sum + line.totalQuantity, 0);
    const poText = order.externalCustomerPo ? `客户PO ${order.externalCustomerPo}` : "客户PO 空";
    const orderTasks = relatedTasks.filter((task) => task.relatedOrderId === order.id);
    const hasBlocker = orderTasks.some((task) => task.blocking);
    const facts = [
      `${qty} 件 · ${order.customer.name}`,
      poText,
      labels.orderStatus(order.status),
    ];
    if (order.requestedDeliveryDate) facts.push(`确认交期 ${order.requestedDeliveryDate}`);
    else if (order.requestedDeliveryText) facts.push(`交期原文 ${order.requestedDeliveryText}，年份未确认`);
    const versionById = new Map(style.versions.map((version) => [version.id, version]));
    const plan = aggregateMaterialPlan(
      order.lines.map((line) => ({
        totalQuantity: line.totalQuantity,
        bomLines: versionById.get(line.styleVersionId ?? "")?.bomLines ?? [],
      })),
    );
    facts.push(...plan.facts);
    facts.push(...colorConfirmationFacts(confirmationRows.filter((row) => row.orderId === order.id)));
    if (role === "sales_sample") facts.push("同一主款，不是新档");
    if (role === "reorder") facts.push("沿用同一主档，不复制款式");
    if (role === "reorder" && hiddenReorders) facts.push(`另有 ${hiddenReorders} 笔翻单未展开`);
    for (const task of orderTasks) facts.push(labels.taskKind(task.kind));
    return {
      id: order.id,
      kind: "order" as const,
      role,
      title: orderTitle(role),
      statusLabel: labels.readiness(order.productionReadiness),
      tone: orderTone(order, role, hasBlocker),
      href: `/orders/${order.id}`,
      facts,
    };
  });

  stages.push(...orderStages);

  const customerBrands = [...new Set(orders.map((order) => order.customer.name))];
  const linkedSeasons = style.seasonLinks
    .map((link) => link.season)
    .sort((left, right) => left.sort - right.sort)
    .map((season) => ({ id: season.id, code: season.code, name: season.name }));

  return {
    style: {
      id: style.id,
      code: style.code,
      name: style.name,
      category: style.category,
      silhouette: style.silhouette,
      imagePath: style.imagePath,
      imageSrc: styleImageSrc(style),
      demoNote: style.demoNote,
    },
    identifiers: {
      styleCode: style.code,
      bulkCodeUnverified: true,
      seasons: linkedSeasons,
      availableSeasons: orgSeasons.map((season) => ({ id: season.id, code: season.code, name: season.name })),
      customerBrands,
      customerPos: orders.map((order) => ({
        orderNo: order.orderNo,
        po: order.externalCustomerPo,
        href: `/orders/${order.id}`,
      })),
      designer: style.designer ? { id: style.designer.id, name: style.designer.name } : null,
      availableDesigners: orgDesigners.map((item) => ({ id: item.id, name: item.name })),
      createdByName: style.createdBy?.name ?? null,
      brand: style.brandOption ? { id: style.brandOption.id, name: style.brandOption.name } : null,
      category: style.categoryOption
        ? {
            id: style.categoryOption.id,
            name: style.categoryOption.name,
            label: categoryOptionLabel(style.categoryOption),
          }
        : null,
      type: style.typeOption ? { id: style.typeOption.id, name: style.typeOption.name } : null,
      year: style.yearOption ? { id: style.yearOption.id, name: style.yearOption.name } : null,
      catalog,
    },
    colorways: buildColorways(orders, confirmationRows),
    stages,
    openBlockers,
  };
}

export async function listStyleSummaries(organizationId: string, viewer: { role?: string; factoryId?: string | null } = {}) {
  const follows = await listStyleFollowLinks(organizationId, viewer);
  const orderScope = { organizationId, ...(viewer.role === "factory" ? { factoryId: viewer.factoryId || "__none__" } : {}) };
  const styles = await prisma.style.findMany({
    where: { organizationId, archivedAt: null, ...(viewer.role === "factory" ? { OR: [{ id: { in: [...follows.keys()] } }, { orderLines: { some: { order: orderScope } } }] } : {}) },
    include: {
      versions: true,
      orderLines: { where: { order: orderScope }, include: { order: { include: { customer: true, factory: { select: { id: true, name: true } } } } } },
      seasonLinks: { include: { season: true } },
      designer: true,
      createdBy: true,
      brandOption: true,
      categoryOption: { include: { parent: true } },
      typeOption: true,
      yearOption: true,
    },
    orderBy: { code: "asc" },
  });

  const candidates = styles.flatMap(style => [
    ...style.orderLines.flatMap(line => line.order.factory ? [line.order.factory] : []),
    ...(follows.get(style.id) ?? []).map(follow => ({ id: follow.factoryId, name: follow.factoryName.trim() })),
  ]);
  const factoryRecords = candidates.length ? await prisma.party.findMany({
    where: { organizationId, kind: "factory", ...(viewer.role === "factory" ? { id: viewer.factoryId || "__none__" } : {}), OR: [
      { id: { in: [...new Set(candidates.flatMap(item => item.id ? [item.id] : []))] } },
      { name: { in: [...new Set(candidates.map(item => item.name).filter(Boolean))] } },
    ] }, select: { id: true, name: true },
  }) : [];
  const factoryById = new Map(factoryRecords.map(factory => [factory.id, factory]));
  const factoriesByName = new Map<string, typeof factoryRecords>();
  for (const factory of factoryRecords) factoriesByName.set(factory.name, [...(factoriesByName.get(factory.name) ?? []), factory]);

  return styles.map((style) => {
    const orderIds = new Set(style.orderLines.map((line) => line.orderId));
    const hasSalesSample = style.orderLines.some((line) => line.order.productionReadiness === "sales_sample");
    const hasCompletedBulk = style.orderLines.some(
      (line) => line.order.status === "completed" || line.order.productionReadiness === "shipped",
    );
    const customerBrands = [...new Set(style.orderLines.map((line) => line.order.customer.name))];
    const orderPos = [...orderIds].map((orderId) => {
      const order = style.orderLines.find((line) => line.orderId === orderId)?.order;
      return { orderNo: order?.orderNo ?? orderId, po: order?.externalCustomerPo ?? null };
    });
    const factories = new Map<string, { id: string | null; name: string }>();
    for (const item of [
      ...style.orderLines.flatMap(line => line.order.factory ? [line.order.factory] : []),
      ...(follows.get(style.id) ?? []).map(follow => ({ id: follow.factoryId, name: follow.factoryName.trim() })),
    ]) {
      if (!item.name) continue;
      const matches = factoriesByName.get(item.name) ?? [];
      // Linked IDs survive a rename; legacy text links only on a unique full-name match.
      const record = item.id ? factoryById.get(item.id) : matches.length === 1 ? matches[0] : undefined;
      if (viewer.role === "factory" && !record) continue;
      factories.set(record?.id ?? `name:${item.name}`, record ?? { id: null, name: item.name });
    }
    return {
      id: style.id,
      code: style.code,
      name: style.name,
      imagePath: style.imagePath,
      imageSrc: styleImageSrc(style),
      category: style.category,
      statusLabel: labels.styleStatus(style.status),
      versionCount: style.versions.length,
      orderCount: orderIds.size,
      extraLabel: hasSalesSample ? "含销售样" : hasCompletedBulk ? "含大货" : null,
      customerBrands,
      orderPos,
      followPos: follows.get(style.id) ?? [],
      factories: [...factories.values()],
      factoryNames: [...new Set([...factories.values()].map(factory => factory.name))],
      seasonCodes: style.seasonLinks.map((link) => link.season.code),
      designerName: style.designer?.name ?? null,
      createdByName: style.createdBy?.name ?? null,
      brandName: style.brandOption?.name ?? null,
      categoryLabel: style.categoryOption ? categoryOptionLabel(style.categoryOption) : style.category,
      typeName: style.typeOption?.name ?? null,
      yearName: style.yearOption?.name ?? null,
      bulkCodeUnverified: true as const,
    };
  });
}
