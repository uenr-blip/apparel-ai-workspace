import { constructionRows } from "./style-construction";
import { assertTransferredRowsUnchanged, hydrateLegacyFollowLinks, persistFollowRows, resolveFollowPartners, validateCustomerProducts } from "./follow-records";
import { productionVersionFromStage } from "./workflow-production";
import { readConstruction } from "@/lib/style-construction";
import { resolveStyleCodes } from "./style-code";
import { verifyFollowTicket } from "@/server/agents/follow-ticket";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { customerPo, followBatchFingerprint, productionPoFacts, validateFollowPo } from "@/server/domain/follow-po";
import { styleImageSrc } from "@/lib/style-image";
import { createId, sha256 } from "@/lib/hash";
import {
  buildSeasonBoard,
  bulkMainLabel,
  type SampleElement,
  normalizeMerchOrder,
  orderColorPieces,
  progressSentence,
  purchaseLines,
  constructionPurchaseLines,
  readStoredMerchStyles,
  type CellPictures,
  type BulkPictures,
  type BulkColor,
  type MerchStyle,
  type SeasonSource,
} from "@/server/domain/merch-sheet";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { lockOrganizationForWrite } from "@/server/services/order-write";
import { Prisma, type Style } from "@prisma/client";

async function assertMerchActor(tx: Prisma.TransactionClient, input: { organizationId: string; userId: string; role: string }) {
  const user = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true } });
  if (!user || user.role !== input.role) throw new ExecutionError("账号或权限已变化，请重新登录后核对");
}

function assertBatchUnchanged(before: MerchStyle[], after: MerchStyle[], kind: string) {
  if (followBatchFingerprint(before, kind) !== followBatchFingerprint(after, kind)) {
    throw new ExecutionError("此跟单已开生产订单，不能直接改 PO、产品编号、采购日期、交期或颜色数量；翻单请新建跟单，原批次须核对生产订单后修订");
  }
}

export async function saveOrderMerch(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  seasonCode?: unknown;
  styles?: unknown;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveOrderMerch)) {
    throw new ExecutionError("当前角色不能改销售样和大货");
  }
  const key = input.idempotencyKey.trim();
  if (!/^[\w-]{8,80}$/.test(key)) throw new ExecutionError("提交标记无效");
  let normalized: ReturnType<typeof normalizeMerchOrder>;
  try {
    normalized = normalizeMerchOrder(input);
  } catch (error) {
    throw new ExecutionError(error instanceof Error ? error.message : "跟单表填得不对");
  }

  let saved: { updatedAt: Date; styles: MerchStyle[]; kind: string; reused: boolean };
  try {
    saved = await prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    await assertMerchActor(tx, input);
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, organizationId: input.organizationId },
      include: { merchSheet: { include: { styles: { orderBy: { sort: "asc" } } } } },
    });
    if (!order) throw new ExecutionError("订单不存在");
    if (order.productionReadiness === "shipped" || order.status === "completed") {
      throw new ExecutionError("已出运的单不再改销售样和大货");
    }
    const linkedFollow = await tx.orderMerchStyle.findFirst({ where: { productionLine: { orderId: order.id } } });
    if (linkedFollow && linkedFollow.sheetId !== order.merchSheet?.id) throw new ExecutionError("此单来自接续开单，请回原跟单修改，不能另建一份总表记录");
    const current = order.merchSheet;
    const before = current ? normalizeMerchOrder({ seasonCode: current.seasonCode, styles: readStoredMerchStyles(current, { styleCode: "", styleName: "" }) }) : null;
    validateFollowPo(normalized.styles, current?.kind ?? "");
    const currentFingerprint = before?.fingerprint;
    const requestHash = sha256(normalized.fingerprint);
    const prior = await tx.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        entityType: "SalesOrder",
        entityId: order.id,
        action: "order.merch_saved",
        payloadJson: { contains: `"idempotencyKey":"${key}"` },
      },
    });
    if (prior && JSON.parse(prior.payloadJson ?? "{}").requestHash !== requestHash) {
      throw new ExecutionError("这次提交标记已用于其他内容，请刷新后重新核对提交");
    }
    if (current && current.styles.length > 0 && currentFingerprint === normalized.fingerprint) {
      return {
        updatedAt: current.updatedAt, kind: current.kind,
        styles: readStoredMerchStyles(current, { styleCode: "", styleName: "" }),
        reused: true,
      };
    }
    if (prior) throw new ExecutionError("这次提交已保存过，此后内容又有变化，请刷新后重新核对");
    if (current && input.expectedUpdatedAt !== current.updatedAt.toISOString()) {
      throw new ExecutionError("销售样或大货已变化，请刷新后重试");
    }
    if (current && before && current.kind) assertBatchUnchanged(before.styles, normalized.styles, current.kind);
    const sheet = current
      ? await tx.orderMerchSheet.update({
          where: { id: current.id },
          data: {
            seasonCode: normalized.seasonCode,
            craftFamily: "",
            salesSampleJson: "{}",
            bulkJson: "{}",
          },
        })
      : await tx.orderMerchSheet.create({
          data: {
            id: createId(),
            organizationId: input.organizationId,
            salesOrderId: order.id,
            seasonCode: normalized.seasonCode,
            craftFamily: "",
            salesSampleJson: "{}",
            bulkJson: "{}",
          },
        });
    await persistFollowRows(tx, sheet.id, normalized.styles);
    const stored = await tx.orderMerchSheet.findUniqueOrThrow({
      where: { id: sheet.id },
      include: { styles: { orderBy: { sort: "asc" } } },
    });
    await writeAudit(
      {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "order.merch_saved",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `已保存这一单的 ${normalized.styles.length} 个款。不是采购，也不是付款。`,
        payloadJson: JSON.stringify({
          actionType: ACTION_TYPES.saveOrderMerch,
          idempotencyKey: key,
          requestHash,
          before: before ? { seasonCode: before.seasonCode, styles: before.styles } : null,
          after: { seasonCode: normalized.seasonCode, styles: normalized.styles },
          basis: "跟单员核对客户 PO 后手动保存；不自动改生产、采购或付款",

          seasonCode: normalized.seasonCode,
          styleCount: normalized.styles.length,
        }),
      },
      tx,
    );
    return { updatedAt: stored.updatedAt, kind: stored.kind, styles: readStoredMerchStyles(stored, { styleCode: "", styleName: "" }), reused: false };
    });
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    if (error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new ExecutionError("销售样和大货没有保存");
    }
    throw error;
  }
  const materialStages = await prisma.workflowStage.findMany({ where: { organizationId: input.organizationId, followRowId: { in: saved.styles.flatMap(s => s.rowId ? [s.rowId] : []) } }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const purchases = saved.styles.flatMap((style) =>
    (materialStages.some(s => s.followRowId === style.rowId) ? constructionPurchaseLines(readConstruction(materialStages.find(s => s.followRowId === style.rowId)?.revisions[0]?.constructionJson), style.salesSample, style.bulk, saved.kind) : purchaseLines(style.salesSample, style.bulk, saved.kind)).map((line) => ({
      ...line,
      styleCode: style.styleCode || style.styleName || "未写款号",
    })),
  );
  return {
    orderId: input.orderId,
    reused: saved.reused,
    expectedUpdatedAt: saved.updatedAt.toISOString(),
    styleCount: saved.styles.length,
    purchases,
    message: saved.reused ? "这一单的款没有新的改动" : `已保存 ${saved.styles.length} 个款。要买数量是算出来的，不是采购单。`,
  };
}

export async function listSeasonBoard(organizationId: string, viewer: { role: string; factoryId: string | null }) {
  const sheets = await prisma.orderMerchSheet.findMany({
    where: {
      organizationId,
      archivedAt: null,
      ...(viewer.role === "factory" ? { order: { factoryId: viewer.factoryId ?? "__none__" } } : {}),
    },
    include: {
      styles: { orderBy: { sort: "asc" } },
      order: {
        include: {
          factory: true,
          lines: { include: { style: true } },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const stageRows = await prisma.workflowStage.findMany({ where: { organizationId, followRowId: { in: sheets.flatMap(s => s.styles.map(r => r.id)) } }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const sources: SeasonSource[] = sheets.flatMap((sheet) => {
    const order = sheet.order;
    const fallback = order?.lines[0]?.style;
    const styles = readStoredMerchStyles(sheet, {
      styleCode: fallback?.code ?? "",
      styleName: fallback?.name ?? "",
    });
    return styles.map((style) => {
      const stage = stageRows.find(s => s.followRowId === style.rowId);
      const linked = order?.lines.find((line) => line.style.code === style.styleCode)?.style;
      return {
        orderId: order?.id ?? sheet.id,
        orderNo: order?.orderNo ?? (sheet.title || "跟单"),
        href: order ? `/orders/${order.id}#merch` : `/orders/follow/${sheet.id}`,
        styleCode: style.styleCode,
        styleName: style.styleName,
        imagePath: linked?.imagePath && !style.imagePath ? linked.imagePath : style.imagePath,
        kind: sheet.kind,
        factoryName: sheet.factoryName || order?.factory?.name || style.salesSample.factoryName,
        seasonCode: sheet.seasonCode,
        craftFamily: style.craftFamily,
        salesSample: style.salesSample,
        bulk: style.bulk,
        construction: stage ? readConstruction(stage.revisions[0]?.constructionJson) : undefined,
      };
    });
  });
  return buildSeasonBoard(sources);
}

export type FollowColorLine = BulkColor;

export type StyleSheetLink = {
  href: string;
  label: string;
};

export type FollowStyleLine = {
  key: string;
  href: string;
  sheetTitle: string;
  seasonCode: string;
  styleHref: string;
  productionHref: string;
  productionProgress: string;
  materialSummary: string;
  others: StyleSheetLink[];
  factoryName: string;
  imageSrc: string;
  styleCode: string;
  styleName: string;
  composition: string;
  orderNo: string;
  po: string;
  purchaseDate: string;
  shipmentDates: string[];
  productionOrderNo: string;
  inboundDate: string;
  shipDate: string;
  button: string;
  zipper: string;
  hook: string;
  metalBadge: string;
  otherTrim: string;
  sampleColors: string;
  colorOpinion: string;
  numericCode: string;
  gsm: string;
  shellWidth: string;
  shellConsumption: string;
  shellPrice: string;
  liningWidth: string;
  liningConsumption: string;
  liningPrice: string;
  buttonPrice: string;
  laborPrice: string;
  otherTrimCost: string;
  totalPrice: string;
  photoSample: string;
  salesSampleQty: string;
  sampleMetal: string;
  liningColor: string;
  mainLabel: string;
  hangtag: string;
  sticker: string;
  note: string;
  pictures: CellPictures;
  sampleElements?: SampleElement[];
  bulkMainLabel?: string;
  bulkPictures?: BulkPictures;
  progress: string;
  colors: FollowColorLine[];
};

export type FollowProductLists = {
  sales: FollowStyleLine[];
  bulk: Array<{ factoryName: string; styles: FollowStyleLine[] }>;
  emptySheets: Array<{ id: string; href: string; title: string; kindLabel: string }>;
};

function toFollowLine(
  sheetId: string,
  href: string,
  sheetTitle: string,
  factoryName: string,
  style: MerchStyle,
  imageSrc: string,
  kind: string,
  index: number,
): FollowStyleLine {
  return {
    key: `${sheetId}:${index}:${style.styleCode}:${customerPo(style, kind)}`,
    href,
    sheetTitle,
    seasonCode: "",
    styleHref: "",
    productionHref: "",
    productionProgress: "",
    materialSummary: "",
    others: [],
    factoryName,
    imageSrc,
    styleCode: style.styleCode,
    styleName: style.styleName,
    composition: style.bulk.composition || style.salesSample.composition,
    orderNo: style.bulk.orderNo,
    po: customerPo(style, kind),
    purchaseDate: style.bulk.purchaseDate,
    shipmentDates: [],
    productionOrderNo: "",
    inboundDate: style.bulk.inboundDate,
    shipDate: style.bulk.shipDate,
    button: style.bulk.button,
    zipper: style.bulk.zipper,
    hook: style.bulk.hook,
    metalBadge: style.bulk.metalBadge,
    otherTrim: style.bulk.otherTrim,
    sampleColors: style.salesSample.colors,
    colorOpinion: style.salesSample.colorOpinion,
    numericCode: style.salesSample.numericCode,
    gsm: style.salesSample.gsm,
    shellWidth: style.salesSample.shellWidth,
    shellConsumption: style.salesSample.shellConsumption,
    shellPrice: style.salesSample.shellPrice,
    liningWidth: style.salesSample.liningWidth,
    liningConsumption: style.salesSample.liningConsumption,
    liningPrice: style.salesSample.liningPrice,
    buttonPrice: style.salesSample.buttonPrice,
    laborPrice: style.salesSample.laborPrice,
    otherTrimCost: style.salesSample.otherTrimCost,
    totalPrice: style.salesSample.totalPrice,
    photoSample: style.salesSample.photoSample,
    salesSampleQty: style.salesSample.salesSample,
    sampleMetal: style.salesSample.metalBadge,
    liningColor: style.salesSample.liningColor,
    mainLabel: style.salesSample.mainLabel,
    hangtag: style.salesSample.hangtag,
    sticker: style.salesSample.sticker,
    note: style.salesSample.note,
    pictures: style.salesSample.pictures,
    sampleElements: style.salesSample.elements,
    bulkMainLabel: bulkMainLabel(style.bulk),
    bulkPictures: style.bulk.pictures,
    progress: progressSentence(style.bulk) || progressSentence(style.salesSample),
    colors: style.bulk.colors.map((color) => ({
      guestColor: color.guestColor,
      factoryColorName: color.factoryColorName,
      qtyText: color.qtyText,
      metalBadge: color.metalBadge,
      colorTrims: color.colorTrims,
      labelColors: color.labelColors,
      pictures: color.pictures,
    })),
  };
}

export async function listFollowProducts(
  organizationId: string,
  viewer: { role: string; factoryId: string | null },
): Promise<FollowProductLists> {
  const sheets = await prisma.orderMerchSheet.findMany({
    where: {
      organizationId,
      archivedAt: null,
      ...(viewer.role === "factory" ? { order: { factoryId: viewer.factoryId ?? "__none__" } } : {}),
    },
    include: {
      styles: { orderBy: { sort: "asc" }, include: { productionLine: { include: { style: true, version: { include: { bomLines: { include: { material: true } } } }, order: { include: { factory: true, production: { orderBy: { createdAt: "asc" } } } } } } } },
      order: { include: { factory: true, lines: { include: { colors: true, style: true, version: { include: { bomLines: { include: { material: true } } } } } }, production: { orderBy: { createdAt: "asc" } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
  const transfers = await prisma.factoryTransfer.findMany({ where: { organizationId, status: "executed" }, select: { orderId: true, newOrderId: true, selectionJson: true } });
  const codes = [...new Set(sheets.flatMap(sheet => sheet.styles.map(row => row.styleCode)).filter(Boolean))];
  const masterByCode = viewer.role === "factory" ? new Map<string, Style>() : await resolveStyleCodes(prisma, organizationId, codes);
  const stageRows = await prisma.workflowStage.findMany({ where: { organizationId, followRowId: { in: sheets.flatMap(s => s.styles.map(r => r.id)) } }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const sales: Array<{ line: FollowStyleLine; sheetId: string }> = [];
  const bulkStyles: Array<{ line: FollowStyleLine; kind: string; sheetId: string }> = [];
  const emptySheets: FollowProductLists["emptySheets"] = [];
  for (const sheet of sheets) {
    const order = sheet.order;
    const fallback = order?.lines[0]?.style;
    const styles = readStoredMerchStyles(sheet, {
      styleCode: fallback?.code ?? "",
      styleName: fallback?.name ?? "",
    });
    const href = `/orders/follow/${sheet.id}`;
    const title = sheet.title || order?.orderNo || "跟单";
    const factoryName = sheet.factoryName || order?.factory?.name || "";
    const place = sheet.kind === "sales_sample" ? "sales" : "bulk";
    if (!styles.length) {
      emptySheets.push({ id: sheet.id, href, title, kindLabel: followKindLabel(sheet.kind) });
      continue;
    }
    for (const [index, style] of styles.entries()) {
      const ownRow = sheet.styles.find(r => r.id === style.rowId);
      const explicitLine = ownRow?.productionLine;
      // Old rows may be unlinked: only an unambiguous full color/quantity match can be displayed.
      const sameRows = styles.filter(s => s.styleCode === style.styleCode);
      const parts = (rows: Array<{ colorName: string; quantity: number }>) => JSON.stringify(rows.map(r => `${r.colorName}:${r.quantity}`).sort());
      const legacyLines = order?.lines.filter(l => l.style.code === style.styleCode && parts(l.colors) === parts(orderColorPieces(style, sheet.kind))) ?? [];
      const orderLine = explicitLine ?? (sameRows.length === 1 && legacyLines.length === 1 ? legacyLines[0] : undefined);
      const rowOrder = explicitLine?.order ?? (orderLine ? order : undefined);
      const linked = orderLine?.style ?? masterByCode.get(style.styleCode);
      const imageSrc =
        style.imagePath || (linked?.imagePath ? styleImageSrc({ id: linked.id, imagePath: linked.imagePath }) : "");
      const line = toFollowLine(sheet.id, `${href}?row=${index}`, title, rowOrder?.factory?.name || factoryName || style.salesSample.factoryName, style, imageSrc, sheet.kind, index);
      line.seasonCode = sheet.seasonCode;
      line.styleHref = linked && viewer.role !== "factory" ? `/styles/${linked.id}` : "";
      line.productionHref = rowOrder ? `/orders/${rowOrder.id}` : "";
      const productionNames: Record<string, string> = { qualified: "合格", good: "合格", shipped: "出运", scrap: "报废", rework: "返工" };
      line.productionProgress = rowOrder ? Object.entries(productionNames).flatMap(([kind, label]) => {
        const qty = rowOrder.production.filter(row => row.kind === kind).reduce((sum, row) => sum + row.quantity, 0);
        return qty ? [`登记${label} ${qty} 件（整张生产单）`] : [];
      }).join("；") || "生产订单暂无产量登记" : "尚未开生产订单";
      if (rowOrder) {
        const events = transfers.filter(t => t.orderId === rowOrder.id || t.newOrderId === rowOrder.id);
        const traces = events.flatMap(t => {
          const selected = JSON.parse(t.selectionJson) as Array<{ styleCode: string; quantity: number }>;
          const qty = selected.filter(r => r.styleCode === style.styleCode).reduce((n, r) => n + r.quantity, 0);
          return qty ? [`${t.orderId === rowOrder.id ? "已转出" : "转厂接收"} ${qty} 件（本款）；点击生产单查看交接记录`] : [];
        });
        if (traces.length) line.productionProgress += `；${traces.join("；")}`;
      }
      line.materialSummary = orderLine?.version?.bomLines.filter(bom => bom.material.organizationId === organizationId).map(bom => [bom.material.code, bom.material.name, bom.material.composition, bom.material.gsm && `${bom.material.gsm} GSM`, bom.material.widthCm && `门幅 ${bom.material.widthCm}`, bom.material.specSummary].filter(Boolean).join(" · ")).join("；") ?? "";
      const stage = stageRows.find(s => s.followRowId === style.rowId);
      const fixedMaterials = orderLine?.version ? constructionRows({ ...orderLine.version, attachments: [] }) : stage ? readConstruction(stage.revisions[0]?.constructionJson) : [];
      if (fixedMaterials.length) {
        line.materialSummary = fixedMaterials.map(r => [r.name, r.fields.composition, r.fields.specification, r.fields.yarnCount, r.fields.size, r.fields.color, r.fields.consumption && `单耗 ${r.fields.consumption}${r.fields.unit || ""}`].filter(Boolean).join(" · ")).join("；");
        const fabrics = fixedMaterials.filter(r => r.group === "fabric" || r.group === "yarn");
        if (fabrics.length) {
          line.composition = fabrics.map(r => `${r.name}：${r.fields.composition || "成分待补"}`).join("；");
          line.gsm = fabrics.length === 1 ? fabrics[0].fields.gsm || "" : "";
          line.shellWidth = fabrics.length === 1 ? fabrics[0].fields.width || "" : "";
          line.shellConsumption = fabrics.length === 1 ? fabrics[0].fields.consumption || "" : "";
        }
      }
      line.productionOrderNo = rowOrder?.orderNo ?? "";
      if (line.po && line.po.toUpperCase() === rowOrder?.externalCustomerPo?.trim().toUpperCase()) {
        line.shipmentDates = [...new Set(rowOrder.production.filter(row => row.kind === "shipped").map(row => row.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })))];
      }
      if (place === "sales") sales.push({ line, sheetId: sheet.id });
      else bulkStyles.push({ line, kind: sheet.kind, sheetId: sheet.id });
    }
  }
  const salesByCode = new Map<string, StyleSheetLink[]>();
  const bulkByCode = new Map<string, StyleSheetLink[]>();
  for (const item of sales) {
    addStyleLink(salesByCode, item.line.styleCode, {
      href: `/orders/follow/${item.sheetId}`,
      label: salesLinkLabel(item.line.sheetTitle),
    });
  }
  for (const item of bulkStyles) {
    if (item.kind !== "bulk") continue;
    addStyleLink(bulkByCode, item.line.styleCode, {
      href: `/orders/follow/${item.sheetId}`,
      label: bulkLinkLabel(item.line.factoryName, item.line.sheetTitle),
    });
  }
  for (const item of sales) item.line.others = linksFor(bulkByCode, item.line.styleCode, `/orders/follow/${item.sheetId}`);
  for (const item of bulkStyles) item.line.others = linksFor(salesByCode, item.line.styleCode, `/orders/follow/${item.sheetId}`);
  const factories = new Map<string, FollowStyleLine[]>();
  for (const item of bulkStyles) {
    const name = item.line.factoryName || "还没写工厂";
    factories.set(name, [...(factories.get(name) ?? []), item.line]);
  }
  return {
    sales: sales.map((item) => item.line),
    bulk: [...factories.entries()].map(([factoryName, styles]) => ({ factoryName, styles })),
    emptySheets,
  };
}

const FOLLOW_KINDS = new Set(["sales_sample", "bulk"]);

function styleCodeKey(code: string) {
  return code.trim().toUpperCase();
}

function addStyleLink(map: Map<string, StyleSheetLink[]>, code: string, link: StyleSheetLink) {
  const key = styleCodeKey(code);
  if (!key) return;
  const list = map.get(key) ?? [];
  if (list.some((item) => item.href === link.href && item.label === link.label)) return;
  list.push(link);
  map.set(key, list);
}

function linksFor(map: Map<string, StyleSheetLink[]>, code: string, href: string) {
  return (map.get(styleCodeKey(code)) ?? []).filter((link) => link.href !== href);
}

function salesLinkLabel(title: string) {
  return title ? `销售样 · ${title}` : "销售样";
}

function bulkLinkLabel(factoryName: string, title: string) {
  const factory = factoryName || "还没写工厂";
  return title ? `大货 · ${factory} · ${title}` : `大货 · ${factory}`;
}

function followKindLabel(kind: string) {
  if (kind === "sales_sample") return "销售样";
  if (kind === "bulk") return "大货";
  return "挂在订单上";
}

function assertKey(idempotencyKey: string) {
  const key = idempotencyKey.trim();
  if (!/^[\w-]{8,80}$/.test(key)) throw new ExecutionError("提交标记无效");
  return key;
}

export async function createFollowSheet(input: {
  organizationId: string;
  userId: string;
  role: string;
  idempotencyKey: string;
  kind: string;
  title: string;
  seasonCode?: string;
  factoryName?: string;
  factoryId?: string | null;
  customerId?: string;
  assistantTicket?: string;
  confirmed?: boolean;
  initialStyles?: unknown[];
  sourceStyleId?: string;
  sourcePo?: string;
  intake?: { sourceId: string; customerId: string; proposalId: string };
}, db?: Prisma.TransactionClient) {
  if (!canApproveAction(input.role, ACTION_TYPES.createFollowSheet)) {
    throw new ExecutionError("当前角色不能新建跟单");
  }
  const key = assertKey(input.idempotencyKey);
  const kind = input.kind.trim();
  if (!FOLLOW_KINDS.has(kind)) throw new ExecutionError("先选销售样或大货");
  const title = input.title.trim().slice(0, 80);
  if (!title) throw new ExecutionError("先写这张跟单叫什么");
  const seasonCode = (input.seasonCode ?? "").trim().slice(0, 40);
  const factoryName = (input.factoryName ?? "").trim().slice(0, 80);
  if (kind === "bulk" && !factoryName) throw new ExecutionError("大货要先写是哪家工厂");
  const create = async (tx: Prisma.TransactionClient) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    const actor = await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true, role: input.role } });
    if (!actor) throw new ExecutionError("当前账号不能新建跟单");
    if (input.assistantTicket && input.confirmed !== true) throw new ExecutionError("请核对表头并明确确认建表");
    if (input.sourcePo && !input.sourceStyleId) throw new ExecutionError("请先选定款式，再登记 PO");
    if (input.sourceStyleId && (input.initialStyles || input.assistantTicket || input.intake)) throw new ExecutionError("请使用独立的款式登记入口");
    const sourceStyle = input.sourceStyleId ? await tx.style.findFirst({ where: { id: input.sourceStyleId, organizationId: input.organizationId, archivedAt: null } }) : null;
    if (input.sourceStyleId && !sourceStyle) throw new ExecutionError("原款式不存在或已归档，请重新核对");
    // Resolve identity on the server; PO and quantities never come from a previous batch.
    const initialStyles = sourceStyle ? [{ styleCode: sourceStyle.code, styleName: sourceStyle.name, salesSample: kind === "sales_sample" ? { po: input.sourcePo ?? "" } : {}, bulk: kind === "bulk" ? { po: input.sourcePo ?? "" } : {} }] : input.initialStyles;
    const normalized = initialStyles ? normalizeMerchOrder({ seasonCode, styles: initialStyles }) : null;
    if (sourceStyle && normalized?.styles[0]?.styleCode !== sourceStyle.code) throw new ExecutionError("款号超过跟单支持长度，请先核对款号");
    if (normalized) validateFollowPo(normalized.styles, kind);
    if (input.intake) {
      const [customer, source] = await Promise.all([
        tx.customer.findFirst({ where: { id: input.intake.customerId, organizationId: input.organizationId } }),
        tx.sourceDocument.findFirst({ where: { id: input.intake.sourceId, organizationId: input.organizationId } }),
      ]);
      if (!customer || !source) throw new ExecutionError("客户或原始资料已变化，请重新核对");
    }
    const partners = await resolveFollowPartners(tx, input.organizationId, { factoryId: input.factoryId, factoryName, customerId: input.intake?.customerId ?? input.customerId });
    if (normalized) await validateCustomerProducts(tx, input.organizationId, partners.customerId, null, normalized.styles);
    const after = { kind, title, seasonCode, ...(sourceStyle ? { sourceStyleId: sourceStyle.id } : {}), ...(input.customerId || input.factoryId ? { customerId: partners.customerId, factoryId: partners.factoryId } : {}), factoryName: kind === "bulk" ? factoryName : "", ...(normalized ? { styles: normalized.styles } : {}), ...(input.intake ? { intake: input.intake } : {}) };

    const prior = await tx.auditEvent.findFirst({
      where: {
        organizationId: input.organizationId,
        action: "follow.sheet_created",
        payloadJson: { contains: `"idempotencyKey":"${key}"` },
      },
    });
    if (prior) {
      if (prior.actorUserId !== input.userId) throw new ExecutionError("请求编号已被使用，请刷新后重试");
      const previous = JSON.parse(prior.payloadJson || "{}");
      if (previous.after && JSON.stringify(previous.after) !== JSON.stringify(after)) throw new ExecutionError("请求编号已经用于其他表头，请刷新核对");
      return { sheetId: prior.entityId, reused: true, message: "这张跟单已经建过" };
    }
    const assistant = input.assistantTicket ? await verifyFollowTicket(tx, input, input.assistantTicket) : null;
    const sheetId = createId();
    await tx.orderMerchSheet.create({
      data: {
        id: sheetId,
        organizationId: input.organizationId,
        seasonCode,
        kind,
        title,
        factoryName: partners.factoryName, factoryId: partners.factoryId, customerId: partners.customerId,
        craftFamily: "",
        salesSampleJson: "{}",
        bulkJson: "{}",
      },
    });
    if (normalized) for (const [sort, style] of normalized.styles.entries()) {
      await tx.orderMerchStyle.create({ data: { id: createId(), sheetId, sort, styleCode: style.styleCode, styleName: style.styleName, craftFamily: style.craftFamily, imagePath: style.imagePath, labDipJson: JSON.stringify(style.labDip), salesSampleJson: JSON.stringify(style.salesSample), bulkJson: JSON.stringify(style.bulk) } });
    }
    await writeAudit(
      {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "follow.sheet_created",
        entityType: "OrderMerchSheet",
        entityId: sheetId,
        summary: `新建跟单「${title}」。不是生产订单，也不是采购。`,
        payloadJson: JSON.stringify({
          actionType: ACTION_TYPES.createFollowSheet,
          idempotencyKey: key,
          kind,
          title,
          seasonCode,
          before: null, after, assistant,
        }),
      },
      tx,
    );
    return { sheetId, reused: false, message: "跟单已建。接下来在这一张单里加款。" };
  };
  return db ? create(db) : prisma.$transaction(create);
}

export async function listFollowDesk(organizationId: string, viewer: { role: string; factoryId: string | null }) {
  const sheets = await prisma.orderMerchSheet.findMany({
    where: {
      organizationId,
      archivedAt: null,
      ...(viewer.role === "factory"
        ? { order: { factoryId: viewer.factoryId ?? "__none__" } }
        : {}),
    },
    include: {
      styles: { orderBy: { sort: "asc" } },
      order: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  return sheets.map((sheet) => {
    const styles = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
    const attached = Boolean(sheet.order);
    return {
      id: sheet.id,
      href: attached && sheet.order ? `/orders/${sheet.order.id}#merch` : `/orders/follow/${sheet.id}`,
      title: sheet.title || sheet.order?.orderNo || "跟单",
      kindLabel: followKindLabel(sheet.kind),
      factoryName: sheet.factoryName,
      seasonCode: sheet.seasonCode,
      styleCount: styles.length,
      orderNo: sheet.order?.orderNo ?? "",
    };
  });
}

export async function getFollowSheet(input: {
  organizationId: string;
  sheetId: string;
  role: string;
  factoryId: string | null;
}) {
  const sheet = await prisma.orderMerchSheet.findFirst({
    where: { id: input.sheetId, organizationId: input.organizationId },
    include: {
      styles: { orderBy: { sort: "asc" }, include: { productionLine: { include: { order: true } } } },
      order: { include: { lines: { include: { style: true, colors: true, order: true } } } },
    },
  });
  if (!sheet) return null;
  if (input.role === "factory" && sheet.order?.factoryId !== input.factoryId) return null;
  if (input.role === "factory" && !sheet.order) return null;
  const stored = readStoredMerchStyles(sheet, { styleCode: "", styleName: "" });
  const aliases = await resolveStyleCodes(prisma, input.organizationId, stored.map(s => s.styleCode));
  const parts = (rows: Array<{ colorName: string; quantity: number }>) => JSON.stringify(rows.map(r => `${r.colorName}:${r.quantity}`).sort());
  return { ...sheet, styles: sheet.styles.map(row => {
    if (row.productionLine) return row;
    const source = stored.find(s => s.rowId === row.id);
    const matching = source ? sheet.order?.lines.filter(l => l.styleId === aliases.get(row.styleCode)?.id && parts(l.colors) === parts(orderColorPieces(source, sheet.kind))) ?? [] : [];
    if (matching.length !== 1 || sheet.styles.filter(r => r.styleCode === row.styleCode).length !== 1) return row;
    return { ...row, productionLineId: matching[0].id, productionLine: matching[0] };
  }) };
}

export async function saveFollowSheet(input: {
  organizationId: string;
  userId: string;
  role: string;
  sheetId: string;
  expectedUpdatedAt: string;
  idempotencyKey: string;
  seasonCode?: unknown;
  factoryName?: unknown;
  factoryId?: string | null;
  customerId?: string | null;
  styles?: unknown;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveOrderMerch)) {
    throw new ExecutionError("当前角色不能改销售样和大货");
  }
  const key = assertKey(input.idempotencyKey);
  let normalized: ReturnType<typeof normalizeMerchOrder>;
  try {
    normalized = normalizeMerchOrder(input);
  } catch (error) {
    throw new ExecutionError(error instanceof Error ? error.message : "跟单表填得不对");
  }
  let saved: { updatedAt: Date; styles: MerchStyle[]; kind: string; reused: boolean };
  try {
    saved = await prisma.$transaction(async (tx) => {
      await lockOrganizationForWrite(tx, input.organizationId);
    await assertMerchActor(tx, input);
      let sheet = await tx.orderMerchSheet.findFirst({
        where: { id: input.sheetId, organizationId: input.organizationId },
        include: { styles: { orderBy: { sort: "asc" } }, order: true },
      });
      if (!sheet) throw new ExecutionError("跟单不存在");
      if (input.role === "factory") throw new ExecutionError("当前角色不能改销售样和大货");
      const enteredFactoryName = (typeof input.factoryName === "string" ? input.factoryName : sheet.factoryName).trim().slice(0, 80);
      const partners = await resolveFollowPartners(tx, input.organizationId, { factoryId: input.factoryId === undefined ? (enteredFactoryName === sheet.factoryName ? sheet.factoryId : null) : input.factoryId, factoryName: enteredFactoryName, customerId: input.customerId === undefined ? (sheet.customerId ?? sheet.order?.customerId) : input.customerId });
      const inherited = await tx.workflowTransfer.findMany({ where: { organizationId: input.organizationId, targetSheetId: sheet.id } });
      if (inherited.some(t => JSON.parse(t.snapshotJson).customerId !== partners.customerId)) throw new ExecutionError("本跟单客户来自阶段交接，不能直接改归属；请核对来源或另建独立跟单");
      const factoryName = partners.factoryName;
      if (sheet.kind === "bulk" && !factoryName) throw new ExecutionError("大货要先写是哪家工厂");
      const before = normalizeMerchOrder({ seasonCode: sheet.seasonCode, styles: readStoredMerchStyles(sheet, { styleCode: "", styleName: "" }) });
      validateFollowPo(normalized.styles, sheet.kind);
      const currentFingerprint = before.fingerprint;
    const requestHash = sha256(JSON.stringify({ fingerprint: normalized.fingerprint, factoryName, ...(input.customerId !== undefined || input.factoryId !== undefined ? { customerId: partners.customerId, factoryId: partners.factoryId } : {}) }));
      const prior = await tx.auditEvent.findFirst({
        where: {
          organizationId: input.organizationId,
          entityType: "OrderMerchSheet",
          entityId: sheet.id,
          action: "follow.merch_saved",
          payloadJson: { contains: `"idempotencyKey":"${key}"` },
        },
      });
    if (prior && JSON.parse(prior.payloadJson ?? "{}").requestHash !== requestHash) {
      throw new ExecutionError("这次提交标记已用于其他内容，请刷新后重新核对提交");
    }
      if (sheet.styles.length > 0 && currentFingerprint === normalized.fingerprint && sheet.factoryName === factoryName && sheet.customerId === partners.customerId && sheet.factoryId === partners.factoryId) {
        return { updatedAt: sheet.updatedAt, kind: sheet.kind, styles: readStoredMerchStyles(sheet, { styleCode: "", styleName: "" }), reused: true };
      }
      if (prior) throw new ExecutionError("这次提交已保存过，此后内容又有变化，请刷新后重新核对");
      if (input.expectedUpdatedAt !== sheet.updatedAt.toISOString()) {
        throw new ExecutionError("销售样或大货已变化，请刷新后重试");
      }
      await hydrateLegacyFollowLinks(tx, sheet, input.userId);
      sheet = await tx.orderMerchSheet.findUniqueOrThrow({ where: { id: sheet.id }, include: { styles: { orderBy: { sort: "asc" } }, order: true } });
      assertTransferredRowsUnchanged(before.styles, normalized.styles, sheet.styles, sheet.kind);
      if (sheet.salesOrderId && factoryName !== sheet.factoryName) throw new ExecutionError("已开生产订单，请记录转厂并核对影响，不能只修改工厂名字");
      if (sheet.salesOrderId && partners.customerId !== (sheet.customerId ?? sheet.order?.customerId)) throw new ExecutionError("已开生产订单的客户归属不能直接改写，请先核对关联单据和凭证");
      await validateCustomerProducts(tx, input.organizationId, partners.customerId ?? sheet.order?.customerId ?? null, sheet.id, normalized.styles);
      await tx.orderMerchSheet.update({
        where: { id: sheet.id },
        data: { seasonCode: normalized.seasonCode, factoryName, factoryId: partners.factoryId, customerId: partners.customerId, craftFamily: "", salesSampleJson: "{}", bulkJson: "{}" },
      });
      await persistFollowRows(tx, sheet.id, normalized.styles);
      const stored = await tx.orderMerchSheet.findUniqueOrThrow({
        where: { id: sheet.id },
        include: { styles: { orderBy: { sort: "asc" } } },
      });
      await writeAudit(
        {
          organizationId: input.organizationId,
          actorUserId: input.userId,
          action: "follow.merch_saved",
          entityType: "OrderMerchSheet",
          entityId: sheet.id,
          summary: `已保存跟单里的 ${normalized.styles.length} 个款。不是采购，也不是付款。`,
          payloadJson: JSON.stringify({
            actionType: ACTION_TYPES.saveOrderMerch,
            idempotencyKey: key,
          requestHash,
          before: before ? { seasonCode: before.seasonCode, styles: before.styles, factoryName: sheet.factoryName, customerId: sheet.customerId, factoryId: sheet.factoryId } : null,
          after: { seasonCode: normalized.seasonCode, styles: normalized.styles, factoryName, customerId: partners.customerId, factoryId: partners.factoryId },
          basis: "跟单员核对客户 PO 后手动保存；不自动改生产、采购或付款",

            seasonCode: normalized.seasonCode,
            styleCount: normalized.styles.length,
          }),
        },
        tx,
      );
      return { updatedAt: stored.updatedAt, kind: stored.kind, styles: readStoredMerchStyles(stored, { styleCode: "", styleName: "" }), reused: false };
    });
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    if (error instanceof Prisma.PrismaClientValidationError || error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new ExecutionError("销售样和大货没有保存");
    }
    throw error;
  }
  const materialStages = await prisma.workflowStage.findMany({ where: { organizationId: input.organizationId, followRowId: { in: saved.styles.flatMap(s => s.rowId ? [s.rowId] : []) } }, include: { revisions: { orderBy: { number: "desc" }, take: 1 } } });
  const purchases = saved.styles.flatMap((style) =>
    (materialStages.some(s => s.followRowId === style.rowId) ? constructionPurchaseLines(readConstruction(materialStages.find(s => s.followRowId === style.rowId)?.revisions[0]?.constructionJson), style.salesSample, style.bulk, saved.kind) : purchaseLines(style.salesSample, style.bulk, saved.kind)).map((line) => ({
      ...line,
      styleCode: style.styleCode || style.styleName || "未写款号",
    })),
  );
  return {
    sheetId: input.sheetId,
    reused: saved.reused,
    expectedUpdatedAt: saved.updatedAt.toISOString(),
    styles: saved.styles,
    styleCount: saved.styles.length,
    purchases,
    message: saved.reused ? "这一单的款没有新的改动" : `已保存 ${saved.styles.length} 个款。要买数量是算出来的，不是采购单。`,
  };
}

export async function openFollowAsOrder(input: {
  organizationId: string;
  userId: string;
  role: string;
  sheetId: string;
  customerId: string;
  idempotencyKey: string;
  expectedUpdatedAt?: string;
  rowIds?: string[];
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.openFollowOrder)) {
    throw new ExecutionError("当前角色不能把跟单开成生产订单");
  }
  const key = assertKey(input.idempotencyKey);
  const customerId = input.customerId.trim();
  if (!customerId) throw new ExecutionError("先选定客户");
  const opened = await prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    await assertMerchActor(tx, input);
    const prior = await tx.auditEvent.findFirst({
      where: { organizationId: input.organizationId, action: "follow.opened_as_order", summary: key },
    });
    let sheet = await tx.orderMerchSheet.findFirst({
      where: { id: input.sheetId, organizationId: input.organizationId },
      include: { styles: { orderBy: { sort: "asc" } }, order: true },
    });
    if (!sheet) throw new ExecutionError("跟单不存在");
    const intakeAudit = await tx.auditEvent.findFirst({ where: { organizationId: input.organizationId, entityId: sheet.id, action: "follow.sheet_created" } });
    const intake = intakeAudit?.payloadJson ? JSON.parse(intakeAudit.payloadJson).after?.intake : null;
    if (intake?.customerId && intake.customerId !== customerId) throw new ExecutionError("客户与收件箱核对记录不一致，请按原客户开单，不可将客户 PO 转给另一个客户");
    if ((sheet.customerId ?? sheet.order?.customerId) && (sheet.customerId ?? sheet.order?.customerId) !== customerId) throw new ExecutionError(sheet.order || sheet.styles.some(row => row.productionLineId)
      ? "此跟单已为其他客户开单，请核对原生产订单，不能重复归给另一个客户"
      : "客户与跟单资料不一致，请核对本次 PO 的客户后再开单");
    const requestHash = sha256(JSON.stringify({ sheetId: input.sheetId, customerId, rowIds: input.rowIds ? [...input.rowIds].sort() : null }));
    if (prior) {
      const payload = JSON.parse(prior.payloadJson ?? "{}");
      if (payload.sheetId !== sheet.id || (payload.requestHash && payload.requestHash !== requestHash)) throw new ExecutionError("这次提交标记已用于其他开单内容，请刷新核对");
      const old = await tx.salesOrder.findFirst({ where: { id: prior.entityId, organizationId: input.organizationId, customerId } });
      if (!old) throw new ExecutionError("原开单记录不完整，请核对历史记录");
      return { orderId: old.id, orderNo: old.orderNo, reused: true, styleCount: payload.styles?.length ?? 0, skipped: (payload.skipped ?? []) as string[] };
    }
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== sheet.updatedAt.toISOString()) throw new ExecutionError("跟单内容已变化，请刷新并重新核对后开单");
    await hydrateLegacyFollowLinks(tx, sheet, input.userId);
    sheet = await tx.orderMerchSheet.findUniqueOrThrow({ where: { id: sheet.id }, include: { styles: { orderBy: { sort: "asc" } }, order: true } });
    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId: input.organizationId, archivedAt: null },
    });
    if (!customer) throw new ExecutionError("客户不存在或不属于当前组织");
    const allStored = readStoredMerchStyles(
      {
        craftFamily: sheet.craftFamily,
        salesSampleJson: sheet.salesSampleJson,
        bulkJson: sheet.bulkJson,
        styles: sheet.styles,
      },
      { styleCode: "", styleName: "" },
    );
    const pendingIds = new Set(sheet.styles.filter(r => !r.productionLineId).map(r => r.id));
    if (input.rowIds && (!input.rowIds.length || new Set(input.rowIds).size !== input.rowIds.length || input.rowIds.some(id => !sheet!.styles.some(r => r.id === id)))) throw new ExecutionError("所选款行已转出或不属于此跟单，请刷新核对");
    const stored = allStored.filter(s => pendingIds.has(s.rowId!) && (!input.rowIds || input.rowIds.includes(s.rowId!)));
    if (!stored.length && sheet.order) return { orderId: sheet.order.id, orderNo: sheet.order.orderNo, reused: true, styleCount: 0, skipped: [] as string[] };
    const poFacts = productionPoFacts(stored, sheet.kind);
    await validateCustomerProducts(tx, input.organizationId, customerId, sheet.id, stored);
    if (stored.some(style => style.bulk.orderNo && style.bulk.orderNo !== customerPo(style, sheet.kind))) {
      throw new ExecutionError("原订单号与 PO 尚未核对，请在跟单中确认原编号的含义后再开单");
    }
    const skipped: string[] = [];
    const lines: Array<{ id: string; rowId: string; styleId: string; styleCode: string; versionId: string | null; colors: Array<{ colorName: string; quantity: number }> }> = [];
    for (const style of stored) {
      const label = style.styleCode || style.styleName || "未写款号";
      const pieces = orderColorPieces(style, sheet.kind);
      if (!pieces.length) {
        skipped.push(`${label}没有可计入的件数`);
        continue;
      }
      if (!style.styleCode) {
        skipped.push(`${label}还没写款号`);
        continue;
      }
      const master = (await resolveStyleCodes(tx, input.organizationId, [style.styleCode])).get(style.styleCode);
      if (!master || master.archivedAt) {
        skipped.push(`${label}还没建档`);
        continue;
      }
      const version = await productionVersionFromStage(tx, { organizationId: input.organizationId, userId: input.userId, rowId: style.rowId!, styleId: master.id }) ?? await tx.styleVersion.findFirst({
        where: { styleId: master.id },
        orderBy: { versionNumber: "desc" },
      });
      lines.push({
        id: createId(),
        rowId: style.rowId!,
        styleId: master.id,
        styleCode: master.code,
        versionId: version?.id ?? null,
        colors: pieces,
      });
    }
    if (!lines.length) {
      throw new ExecutionError(skipped.length ? skipped.join("；") : "这张跟单还没有能开成生产订单的款");
    }
    const partners = await resolveFollowPartners(tx, input.organizationId, { factoryId: sheet.factoryId, factoryName: sheet.factoryName, customerId }, sheet.kind === "bulk");
    const orders = await tx.salesOrder.findMany({
      where: { organizationId: input.organizationId },
      select: { orderNo: true },
    });
    let max = 0;
    for (const row of orders) {
      const matched = /^DEMO-ORD-(\d+)$/.exec(row.orderNo);
      if (matched) max = Math.max(max, Number(matched[1]));
    }
    const orderNo = `DEMO-ORD-${String(max + 1).padStart(3, "0")}`;
    const source = await tx.sourceDocument.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        contentHash: sha256(`follow-order:${sheet.id}:${key}`),
        origin: "follow-sheet",
        mimeType: "text/plain",
        rawText: JSON.stringify({ title: sheet.title, sheetId: sheet.id, customerId, intakeSourceId: intake?.sourceId ?? null, ...poFacts, styles: stored, note: "客户 PO 原始要求快照；不下的颜色不计入生产，不批准资料或投产" }),
        receivedAt: new Date(),
        parseStatus: "succeeded",
      },
    });
    const order = await tx.salesOrder.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        orderNo,
        customerId: customer.id,
        factoryId: partners.factoryId,
        status: "draft",
        productionReadiness: "blocked_incomplete_spec",
        externalCustomerPo: poFacts.po || null,
        requestedDeliveryText: poFacts.requestedShipDate || null,
        sourceDocumentId: source.id,
        createdByUserId: input.userId,
        notes: `从跟单「${sheet.title}」开出。不下的颜色没有计入。还不能投产，也还没有采购和付款。`,
        lines: {
          create: lines.map((line) => ({
            id: line.id,
            styleId: line.styleId,
            styleVersionId: line.versionId,
            totalQuantity: line.colors.reduce((sum, color) => sum + color.quantity, 0),
            colors: {
              create: line.colors.map((color) => ({
                id: createId(),
                colorName: color.colorName,
                quantity: color.quantity,
              })),
            },
          })),
        },
      },
    });
    await tx.orderMerchSheet.update({
      where: { id: sheet.id },
      data: { salesOrderId: sheet.salesOrderId ?? order.id, customerId, factoryId: partners.factoryId },
    });
    for (const line of lines) await tx.orderMerchStyle.update({ where: { id: line.rowId }, data: { productionLineId: line.id } });
    await tx.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: "补齐各尺码数量",
        kind: "missing_size_breakdown",
        status: "open",
        blocking: true,
        assigneeRole: "salesperson",
        relatedOrderId: order.id,
        relatedStyleId: lines[0]?.styleId ?? null,
        sourceDocumentId: source.id,
        note: "跟单开成生产订单后，还要在本单补色尺。布没到不能做，货没出不能当完成。",
      },
    });
    await writeAudit(
      {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "follow.opened_as_order",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: key,
        payloadJson: JSON.stringify({
          requestHash,
          sheetId: sheet.id,
          orderNo,
          customerId,
          customerPo: poFacts.po,
          purchaseDate: poFacts.purchaseDate,
          requestedShipDate: poFacts.requestedShipDate,
          before: { salesOrderId: sheet.salesOrderId, rows: lines.map(l => ({ rowId: l.rowId, productionLineId: null })) },
          after: { salesOrderId: order.id, customerId, externalCustomerPo: poFacts.po, styles: stored, rows: lines.map(l => ({ rowId: l.rowId, productionLineId: l.id })) },
          basis: { sheetUpdatedAt: sheet.updatedAt.toISOString(), sourceDocumentId: source.id },
          styles: lines.map((line) => line.styleCode),
          skipped,
        }),
      },
      tx,
    );
    return { orderId: order.id, orderNo, reused: false, styleCount: lines.length, skipped };
  });
  return {
    ...opened,
    message: opened.reused
      ? `这张跟单已经是生产订单 ${opened.orderNo}`
      : `已开成生产订单 ${opened.orderNo}。接下来在这张订单上对料、收布、放行和出货。还没有采购，也没有付款。`,
  };
}
