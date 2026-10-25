import { ACTION_TYPES } from "@/lib/constants";
import { readConstruction } from "@/lib/style-construction";
import { lockOrganizationForWrite } from "./order-write";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { extractFromText } from "@/server/ai/provider";
import { extractRibSpec, parseSizeLines } from "@/server/ai/size-lines";
import { ExecutionError } from "@/server/services/execution";
import { writeAudit } from "@/server/services/intake";
import { canApproveAction } from "@/server/permissions";
import type { Prisma } from "@prisma/client";

export class OrderPrepConflictError extends ExecutionError {
  readonly code = "conflict" as const;
  constructor(message = "资料已被他人修改，请刷新后重试") {
    super(message);
    this.name = "OrderPrepConflictError";
  }
}

export type SizeBreakdownInput = {
  colorName: string;
  breakdown: Record<string, number | string | null | undefined>;
};

type PrepColor = {
  id: string;
  colorName: string;
  quantity: number;
  sizes: Array<{ sizeCode: string; quantity: number }>;
};

type OrderWithPrep = {
  id: string;
  organizationId: string;
  status: string;
  productionReadiness: string;
  requestedDeliveryDate: string | null;
  notes: string | null;
  updatedAt: Date;
  organization: { demoNote: string };
  lines: Array<{
    id: string;
    styleId: string;
    styleVersionId: string | null;
    totalQuantity: number;
    version: {
      id: string;
      styleId: string;
      versionNumber: number;
      status: string;
      cuffType: string;
      changeSummary: string;
      specNotes: string;
      constructionJson: string;
    } | null;
    colors: PrepColor[];
  }>;
  tasks: Array<{ id: string; kind: string; status: string }>;
};

export type ExtractedSizeCell = {
  quantity: number | null;
  sourceText: string | null;
  start: number | null;
  end: number | null;
  kind: "extracted" | "inferred" | "unknown" | "conflict";
  note: string | null;
};

function parseSizeCodes(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new ExecutionError("尺码配置损坏，无法补资料");
  }
  return parsed;
}

export async function resolveSizeCodes(organizationId: string, styleId: string): Promise<string[]> {
  const sku = await prisma.sku.findFirst({
    where: { styleId },
    include: { sizeScale: true },
  });
  if (sku) return parseSizeCodes(sku.sizeScale.sizesJson);
  const standard = await prisma.sizeScale.findFirst({
    where: { organizationId, id: "size-standard" },
  });
  if (standard) return parseSizeCodes(standard.sizesJson);
  const fallback = await prisma.sizeScale.findFirst({ where: { organizationId } });
  if (!fallback) throw new ExecutionError("当前组织没有适用尺码配置");
  return parseSizeCodes(fallback.sizesJson);
}

function parseQty(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const qty = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(qty) || !Number.isInteger(qty)) {
    throw new ExecutionError("尺码数量必须是整数");
  }
  if (qty < 0) throw new ExecutionError("尺码数量不能为负");
  return qty;
}

function flattenSizes(sizes: SizeBreakdownInput[]) {
  return sizes
    .flatMap((row) =>
      Object.entries(row.breakdown).map(([sizeCode, raw]) => {
        const quantity = parseQty(raw);
        if (quantity === null) return null;
        return { colorName: row.colorName, sizeCode, quantity };
      }),
    )
    .filter((row): row is { colorName: string; sizeCode: string; quantity: number } => Boolean(row))
    .sort((a, b) => `${a.colorName}:${a.sizeCode}`.localeCompare(`${b.colorName}:${b.sizeCode}`));
}

function fingerprint(input: {
  sizes: SizeBreakdownInput[];
  ribSpec: string;
  confirmedDeliveryDate: string | null;
}) {
  return sha256(
    JSON.stringify({
      sizes: flattenSizes(input.sizes),
      ribSpec: input.ribSpec.trim(),
      confirmedDeliveryDate: input.confirmedDeliveryDate,
    }),
  );
}

function currentFingerprint(colors: PrepColor[], ribSpec: string, deliveryDate: string | null) {
  return fingerprint({
    sizes: colors.map((color) => ({
      colorName: color.colorName,
      breakdown: Object.fromEntries(color.sizes.map((size) => [size.sizeCode, size.quantity])),
    })),
    ribSpec,
    confirmedDeliveryDate: deliveryDate,
  });
}

function colorSummaries(colors: PrepColor[], provided: Map<string, Map<string, number>>) {
  return colors.map((color) => {
    const cells = provided.get(color.colorName) ?? new Map<string, number>();
    const filled = [...cells.values()].reduce((sum, qty) => sum + qty, 0);
    return {
      colorName: color.colorName,
      required: color.quantity,
      filled,
      unknown: cells.size === 0,
      aligned: filled === color.quantity,
      diff: filled - color.quantity,
    };
  });
}

function sizesComplete(summaries: Array<{ aligned: boolean }>) {
  return summaries.length > 0 && summaries.every((row) => row.aligned);
}

function chineseMessage(input: {
  complete: boolean;
  ribRecorded: boolean;
  hasRibTask: boolean;
  yearConfirmed: boolean;
}) {
  const yearNote = input.yearConfirmed ? "，交期年份已确认" : "";
  if (!input.complete) return `资料已保存，色尺数量尚未对齐，不能标记补齐或投产${yearNote}`;
  if (input.hasRibTask && !input.ribRecorded) return `资料已保存，罗纹规格尚未记录${yearNote}`;
  if (input.hasRibTask && input.ribRecorded) return `资料已保存，罗纹规格待批准${yearNote}`;
  return `资料已保存，生产限制仍按实际校验结果保留${yearNote}`;
}

function readinessFor(input: {
  current: string;
  complete: boolean;
  ribRecorded: boolean;
  hasRibTask: boolean;
}) {
  const mutable = input.current === "blocked_incomplete_spec" || input.current === "blocked_unapproved_spec";
  if (!mutable) return input.current;
  if (!input.complete || (input.hasRibTask && !input.ribRecorded)) return "blocked_incomplete_spec";
  if (input.hasRibTask && input.ribRecorded) return "blocked_unapproved_spec";
  return "blocked_incomplete_spec";
}

async function loadOrder(organizationId: string, orderId: string): Promise<OrderWithPrep> {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, organizationId },
    include: {
      organization: true,
      lines: { include: { colors: { include: { sizes: true } }, version: true } },
      tasks: true,
    },
  });
  if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
  return order;
}

async function ensureDraftVersion(
  tx: Prisma.TransactionClient,
  line: OrderWithPrep["lines"][number],
  actorNote: string,
) {
  if (line.version?.status === "draft") return line.version;
  const approved = line.version?.status === "approved" ? line.version : null;
  const latest = await tx.styleVersion.findFirst({
    where: { styleId: line.styleId },
    orderBy: { versionNumber: "desc" },
  });
  const created = await tx.styleVersion.create({
    data: {
      id: createId(),
      styleId: line.styleId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      status: "draft",
      cuffType: approved?.cuffType ?? latest?.cuffType ?? "常规",
      changeSummary: actorNote,
      constructionJson: approved?.constructionJson ?? latest?.constructionJson ?? "[]",
      specNotes: "",
    },
  });
  const sourceVersionId = approved?.id ?? latest?.id ?? line.styleVersionId ?? null;
  if (sourceVersionId) {
    const bom = await tx.bomLine.findMany({ where: { styleVersionId: sourceVersionId } });
    for (const row of bom) {
      await tx.bomLine.create({
        data: {
          id: createId(),
          styleVersionId: created.id,
          materialId: row.materialId,
          consumption: row.consumption,
          unit: row.unit,
          includesAllowance: row.includesAllowance,
          allowanceRate: row.allowanceRate,
          colorScope: row.colorScope,
          confirmed: row.confirmed,
        },
      });
    }
  }
  await tx.orderLine.update({
    where: { id: line.id },
    data: { styleVersionId: created.id },
  });
  return created;
}

export async function referenceApprovedMaterials(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveStyleBomDraft)) throw new ExecutionError("无权引用面辅料");
  return prisma.$transaction(async (tx) => {
    await lockOrganizationForWrite(tx, input.organizationId);
    if (!await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("无权引用面辅料");
    const order = await tx.salesOrder.findFirst({
      where: { id: input.orderId, organizationId: input.organizationId },
      include: { lines: { include: { version: { include: { bomLines: true } } } } },
    });
    if (!order) throw new ExecutionError("订单不存在或不属于当前组织");
    const line = order.lines[0];
    if (!line?.version) throw new ExecutionError("本单还没有资料草稿");
    if (line.version.status !== "draft") throw new ExecutionError("已批准版本不能就地写入面辅料");
    if (line.version.bomLines.length > 0) throw new ExecutionError("本单草稿已有面辅料");
    const approved = await tx.styleVersion.findFirst({
      where: { styleId: line.styleId, status: "approved" },
      orderBy: { versionNumber: "desc" },
      include: { bomLines: true },
    });
    if (!approved || approved.bomLines.length === 0) throw new ExecutionError("该款没有可引用的已批准面辅料");
    for (const row of approved.bomLines) {
      await tx.bomLine.create({
        data: {
          id: createId(),
          styleVersionId: line.version.id,
          materialId: row.materialId,
          consumption: row.consumption,
          unit: row.unit,
          includesAllowance: row.includesAllowance,
          allowanceRate: row.allowanceRate,
          colorScope: row.colorScope,
          confirmed: row.confirmed,
        },
      });
    }
    const note = `引用已批准第 ${approved.versionNumber} 版面辅料 ${approved.bomLines.length} 行，未覆盖已批准版本，单耗沿用已批准资料，本单资料仍未批准`;
    const retainedProcesses = readConstruction(line.version.constructionJson).filter(r => r.group === "process");
    const construction = [...readConstruction(approved.constructionJson).filter(r => r.group !== "process" && approved.bomLines.some(b => b.materialId === r.materialId)).map(r => ({ ...r, key: retainedProcesses.some(p => p.key === r.key) ? createId() : r.key })), ...retainedProcesses];
    await tx.styleVersion.update({
      where: { id: line.version.id },
      data: { changeSummary: line.version.changeSummary ? `${line.version.changeSummary}；${note}` : note, constructionJson: JSON.stringify(construction) },
    });
    await writeAudit(
      {
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "order.reference_approved_bom",
        entityType: "StyleVersion",
        entityId: line.version.id,
        summary: note,
        payloadJson: JSON.stringify({
          orderId: order.id,
          sourceVersionId: approved.id,
          copied: approved.bomLines.length,
          before: { constructionJson: line.version.constructionJson, materialIds: [] }, after: { construction, materialIds: approved.bomLines.map(b => b.materialId) },
        }),
      },
      tx,
    );
    return { versionId: line.version.id, copied: approved.bomLines.length, sourceVersionId: approved.id };
  });
}

async function addDraftColors(
  order: OrderWithPrep,
  incoming: Array<{ colorName: string; quantity: number }>,
) {
  const line = order.lines[0];
  if (!line) throw new ExecutionError("订单没有关联款式");
  const existing = new Set(line.colors.map((color) => color.colorName));
  const created: Array<{ colorName: string; quantity: number }> = [];
  for (const row of incoming) {
    if (existing.has(row.colorName)) throw new ExecutionError(`颜色 ${row.colorName} 已在当前订单中`);
    existing.add(row.colorName);
    created.push(row);
  }
  if (!created.length) return;
  await prisma.orderColorQty.createMany({
    data: created.map((row) => ({
      id: createId(),
      lineId: line.id,
      colorName: row.colorName,
      quantity: row.quantity,
    })),
  });
  const nextTotal = line.colors.reduce((sum, color) => sum + color.quantity, 0) + created.reduce((sum, row) => sum + row.quantity, 0);
  await prisma.orderLine.update({
    where: { id: line.id },
    data: { totalQuantity: nextTotal },
  });
}

export async function getOrderPrepContext(organizationId: string, orderId: string) {
  const order = await loadOrder(organizationId, orderId);
  const styleId = order.lines[0]?.styleId;
  const sizeCodes = styleId ? await resolveSizeCodes(organizationId, styleId) : [];
  const shipped = order.status === "completed" || order.productionReadiness === "shipped";
  return {
    order,
    sizeCodes,
    expectedUpdatedAt: order.updatedAt.toISOString(),
    demoNote: order.organization.demoNote,
    canEdit: !shipped,
    shipped,
  };
}

export async function saveOrderPrep(input: {
  organizationId: string;
  userId: string;
  role: string;
  orderId: string;
  sizes: SizeBreakdownInput[];
  newColors?: Array<{ colorName: string; quantity: number }>;
  confirmedDeliveryDate?: string | null;
  ribSpec?: string | null;
  expectedUpdatedAt: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.completeOrderPrep)) {
    throw new ExecutionError("当前角色无权补齐订单资料");
  }

  let order = await loadOrder(input.organizationId, input.orderId);
  const incomingColors = (input.newColors ?? [])
    .map((row) => ({ colorName: row.colorName.trim(), quantity: Number(row.quantity) }))
    .filter((row) => row.colorName && Number.isFinite(row.quantity) && row.quantity > 0);
  if (incomingColors.length) {
    await addDraftColors(order, incomingColors);
    order = await loadOrder(input.organizationId, input.orderId);
  }
  const colors = order.lines.flatMap((line) => line.colors);
  if (colors.length === 0) throw new ExecutionError("订单没有颜色数量，无法补尺码");
  const styleId = order.lines[0]?.styleId;
  if (!styleId) throw new ExecutionError("订单没有关联款式");
  const sizeCodes = await resolveSizeCodes(input.organizationId, styleId);
  const sizeSet = new Set(sizeCodes);
  const colorSet = new Set(colors.map((color) => color.colorName));
  const ribSpec = (input.ribSpec ?? "").trim();
  const confirmedDeliveryDate = input.confirmedDeliveryDate?.trim() ? input.confirmedDeliveryDate.trim() : null;
  if (confirmedDeliveryDate && !/^\d{4}-\d{2}-\d{2}$/.test(confirmedDeliveryDate)) {
    throw new ExecutionError("确认交期必须是 YYYY-MM-DD");
  }

  for (const row of input.sizes) {
    if (!colorSet.has(row.colorName)) throw new ExecutionError(`颜色 ${row.colorName} 不在当前订单中`);
    for (const [sizeCode, raw] of Object.entries(row.breakdown)) {
      if (parseQty(raw) === null) continue;
      if (!sizeSet.has(sizeCode)) throw new ExecutionError(`尺码 ${sizeCode} 不在当前适用尺码配置中`);
    }
  }

  const incomingHash = fingerprint({
    sizes: input.sizes,
    ribSpec,
    confirmedDeliveryDate,
  });
  const existingRib = order.lines.map((line) => line.version?.specNotes ?? "").find(Boolean) ?? "";
  const existingHash = currentFingerprint(colors, existingRib, order.requestedDeliveryDate);
  const stamp = order.updatedAt.toISOString();
  if (input.expectedUpdatedAt !== stamp && incomingHash !== existingHash) {
    throw new OrderPrepConflictError();
  }

  const provided = new Map<string, Map<string, number>>();
  for (const color of colors) provided.set(color.colorName, new Map());
  for (const row of flattenSizes(input.sizes)) {
    provided.get(row.colorName)?.set(row.sizeCode, row.quantity);
  }
  const summaries = colorSummaries(colors, provided);
  const complete = sizesComplete(summaries);
  const hasRibTask = order.tasks.some((task) => task.kind === "missing_rib_spec");
  const ribRecorded = Boolean(ribSpec || existingRib);
  const nextReadiness = readinessFor({
    current: order.productionReadiness,
    complete,
    ribRecorded: Boolean(ribSpec) || Boolean(existingRib),
    hasRibTask,
  });

  const yearConfirmed = Boolean(confirmedDeliveryDate || order.requestedDeliveryDate);

  if (incomingHash === existingHash) {
    const sizeTask = order.tasks.find((task) => task.kind === "missing_size_breakdown");
    const ribTask = order.tasks.find((task) => task.kind === "missing_rib_spec");
    const draft = order.lines.map((line) => line.version).find((version) => version?.status === "draft") ?? order.lines[0]?.version;
    return {
      orderId: order.id,
      reused: true,
      sizeTaskStatus: complete ? "done" : sizeTask?.status ?? "open",
      ribTaskStatus: ribTask?.status ?? "open",
      productionReadiness: nextReadiness,
      versionStatus: draft?.status ?? "draft",
      versionNumber: draft?.versionNumber ?? null,
      requestedDeliveryDate: order.requestedDeliveryDate,
      updatedAt: stamp,
      sizeCodes,
      message: chineseMessage({ complete, ribRecorded, hasRibTask, yearConfirmed }),
      colorSummaries: summaries,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.salesOrder.findFirst({
      where: { id: order.id, organizationId: input.organizationId },
      include: {
        lines: { include: { colors: { include: { sizes: true } }, version: true } },
        tasks: true,
      },
    });
    if (!latest) throw new ExecutionError("订单不存在或不属于当前组织");
    if (latest.updatedAt.toISOString() !== stamp && incomingHash !== existingHash) {
      throw new OrderPrepConflictError();
    }

    for (const color of colors) {
      const cells = provided.get(color.colorName) ?? new Map<string, number>();
      await tx.orderSizeQty.deleteMany({ where: { colorId: color.id } });
      const rows = [...cells.entries()].map(([sizeCode, quantity]) => ({
        id: createId(),
        colorId: color.id,
        sizeCode,
        quantity,
      }));
      if (rows.length) await tx.orderSizeQty.createMany({ data: rows });
    }

    let draftVersion: { id: string; versionNumber: number; status: string; changeSummary: string; specNotes: string } | null = null;
    for (const line of order.lines) {
      const draft = await ensureDraftVersion(tx, line, "由订单补充资料创建草稿，未覆盖已批准历史版本");
      const nextNotes = ribSpec || draft.specNotes;
      const summaryLine = ribSpec ? `补充资料：记录罗纹规格草稿，待批准` : "补充资料：更新色尺草稿";
      await tx.styleVersion.update({
        where: { id: draft.id },
        data: {
          specNotes: nextNotes,
          changeSummary: draft.changeSummary.includes(summaryLine)
            ? draft.changeSummary
            : `${draft.changeSummary}；${summaryLine}`,
        },
      });
      draftVersion = { ...draft, specNotes: nextNotes, changeSummary: draft.changeSummary };
    }

    const sizeTaskStatus = complete ? "done" : "open";
    if (order.tasks.some((task) => task.kind === "missing_size_breakdown")) {
      await tx.taskItem.updateMany({
        where: { relatedOrderId: order.id, kind: "missing_size_breakdown" },
        data: {
          status: sizeTaskStatus,
          note: complete ? "色尺合计与订单颜色件数一致" : "色尺草稿未对齐，不能标记补齐",
        },
      });
    }

    if (order.tasks.some((task) => task.kind === "missing_delivery_year")) {
      const nextDate = confirmedDeliveryDate ?? order.requestedDeliveryDate;
      await tx.taskItem.updateMany({
        where: { relatedOrderId: order.id, kind: "missing_delivery_year" },
        data: {
          status: nextDate ? "done" : "open",
          note: nextDate
            ? `交期年份已由业务员确认为 ${nextDate}，不是系统自动写成事实`
            : "原文未写年份，确认交期前不得把推断年当成事实",
        },
      });
    }

    const message = chineseMessage({
      complete,
      ribRecorded: Boolean(ribSpec) || Boolean(existingRib),
      hasRibTask,
      yearConfirmed: Boolean(confirmedDeliveryDate || order.requestedDeliveryDate),
    });
    await tx.salesOrder.update({
      where: { id: order.id },
      data: {
        requestedDeliveryDate: confirmedDeliveryDate ?? order.requestedDeliveryDate,
        productionReadiness: nextReadiness,
        notes: message,
      },
    });

    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "order.prep_saved",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: message,
        payloadJson: JSON.stringify({ fingerprint: incomingHash, complete, ribRecorded: Boolean(ribSpec) }),
      },
    });

    const updated = await tx.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    const sizeTask = await tx.taskItem.findFirst({
      where: { relatedOrderId: order.id, kind: "missing_size_breakdown" },
    });
    const ribTask = await tx.taskItem.findFirst({
      where: { relatedOrderId: order.id, kind: "missing_rib_spec" },
    });

    return {
      orderId: order.id,
      reused: false,
      sizeTaskStatus: sizeTask?.status ?? sizeTaskStatus,
      ribTaskStatus: ribTask?.status ?? "open",
      productionReadiness: nextReadiness,
      versionStatus: draftVersion?.status ?? "draft",
      versionNumber: draftVersion?.versionNumber ?? null,
      requestedDeliveryDate: updated.requestedDeliveryDate,
      updatedAt: updated.updatedAt.toISOString(),
      sizeCodes,
      message,
      colorSummaries: summaries,
    };
  });

  return result;
}

export const completeOrderPrep = saveOrderPrep;

export async function extractOrderPrep(input: { organizationId: string; orderId: string; text: string }) {
  const order = await loadOrder(input.organizationId, input.orderId);
  const colors = order.lines.flatMap((line) => line.colors);
  const styleId = order.lines[0]?.styleId;
  if (!styleId) throw new ExecutionError("订单没有关联款式");
  const sizeCodes = await resolveSizeCodes(input.organizationId, styleId);
  const { extraction, mode, calledLiveModel } = await extractFromText(input.text);
  const parsed = parseSizeLines(input.text, colors.map((color) => color.colorName), sizeCodes);
  const rib = extractRibSpec(input.text) ?? (extraction.modifications.find((item) => item.field === "ribSpec")
    ? {
        value: extraction.modifications.find((item) => item.field === "ribSpec")!.requested,
        sourceText: extraction.modifications.find((item) => item.field === "ribSpec")!.sourceText,
        start: extraction.modifications.find((item) => item.field === "ribSpec")!.start,
        end: extraction.modifications.find((item) => item.field === "ribSpec")!.end,
      }
    : null);

  const byColor = new Map(
    colors.map((color) => [
      color.colorName,
      {
        colorName: color.colorName,
        required: color.quantity,
        applicable: true,
        breakdown: {} as Record<string, ExtractedSizeCell>,
      },
    ]),
  );

  for (const line of parsed.lines) {
    const target = byColor.get(line.colorName);
    if (!target) continue;
    target.breakdown[line.sizeCode] = {
      quantity: line.quantity,
      sourceText: line.sourceText,
      start: line.start,
      end: line.end,
      kind: line.kind,
      note: line.note,
    };
  }

  const missing: string[] = [];
  if (parsed.lines.filter((line) => line.kind === "extracted").length === 0) missing.push("尺码明细");
  if (!rib) missing.push("罗纹规格");

  return {
    mode,
    calledLiveModel,
    demoLabeled: true,
    sizeCodes,
    sizes: [...byColor.values()],
    ribSpec: rib
      ? { value: rib.value, sourceText: rib.sourceText, start: rib.start, end: rib.end, kind: "extracted" as const }
      : null,
    missing,
    conflicts: parsed.conflicts,
    unknowns: extraction.unknowns,
    notes: [...new Set([
      ...extraction.notes,
      calledLiveModel ? "已调用真实模型" : "未调用真实模型",
      "以上提取需人工确认后才会写入；未提供的数量保持未知，不会自动补齐。",
    ])],
  };
}
