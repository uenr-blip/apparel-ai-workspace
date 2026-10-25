import { readConstruction } from "@/lib/style-construction";
import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { d } from "@/server/domain/procurement";
import { ExecutionError } from "@/server/services/execution";

export const BOM_CONSUMPTION_PENDING = "pending";

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter((id) => id.trim()))];
}

export function isRecordedConsumption(value: string) {
  if (!value || value === BOM_CONSUMPTION_PENDING) return false;
  try {
    const amount = d(value);
    return amount.isFinite() && amount.gt(0);
  } catch {
    return false;
  }
}

export function parseConsumptionInput(raw: string | undefined) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === BOM_CONSUMPTION_PENDING) return BOM_CONSUMPTION_PENDING;
  try {
    const amount = d(trimmed);
    if (!amount.isFinite() || amount.lte(0)) throw new Error("invalid");
    return amount.toFixed();
  } catch {
    throw new ExecutionError("单耗必须是大于 0 的数字");
  }
}

export async function saveStyleBomDraft(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  materialIds: string[];
  consumptions?: Record<string, string>;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveStyleBomDraft)) {
    throw new ExecutionError("当前角色无权写入面辅料草稿");
  }

  const materialIds = uniqueIds(input.materialIds);
  if (materialIds.length === 0) throw new ExecutionError("请至少选择一种面辅料");

  return prisma.$transaction(async (tx) => {
  await lockOrganizationForWrite(tx, input.organizationId);
  if (!await tx.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new ExecutionError("当前账号无权修改资料");
  const style = await tx.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
    include: { versions: { orderBy: { versionNumber: "desc" }, include: { bomLines: true } } },
  });
  if (!style) throw new ExecutionError("款式不存在或不属于当前组织");

  const materials = await tx.material.findMany({
    where: { organizationId: input.organizationId, archivedAt: null, id: { in: materialIds } },
  });
  if (materials.length !== materialIds.length) {
    throw new ExecutionError("材料不存在或不属于当前组织");
  }
  const materialById = new Map(materials.map((row) => [row.id, row]));

  const latestDraft = style.versions.find((version) => version.status !== "approved") ?? null;
  const latestApproved = style.versions.find((version) => version.status === "approved") ?? null;
  const template = latestDraft ?? latestApproved ?? style.versions[0];
  const sourceLines = [...(latestDraft?.bomLines ?? []), ...(latestApproved?.bomLines ?? [])];

    let target = latestDraft;
    let createdDraft = false;
    if (!target) {
      const maxVersion = style.versions[0]?.versionNumber ?? 0;
      target = await tx.styleVersion.create({
        data: {
          id: createId(),
          styleId: style.id,
          versionNumber: maxVersion + 1,
          status: "draft",
          cuffType: template?.cuffType ?? "常规",
          specNotes: template?.specNotes ?? "",
          processNotes: template?.processNotes ?? "",
          patternRevision: template?.patternRevision ?? "",
          constructionJson: template?.constructionJson ?? "[]",
          changeSummary: "建档写入面辅料草稿，用量待工厂确认，不得作为正式生产依据",
        },
        include: { bomLines: true },
      });
      if (template) {
        const attachments = await tx.styleVersionAttachment.findMany({ where: { styleVersionId: template.id } });
        if (attachments.length) await tx.styleVersionAttachment.createMany({ data: attachments.map(a => ({ ...a, id: createId(), styleVersionId: target!.id })) });
      }
      createdDraft = true;
    }

    await tx.bomLine.deleteMany({ where: { styleVersionId: target.id } });
    const nextLines = materialIds.map((materialId) => {
      const material = materialById.get(materialId)!;
      const previous = sourceLines.find((line) => line.materialId === materialId);
      const requested = input.consumptions && Object.prototype.hasOwnProperty.call(input.consumptions, materialId);
      const consumption = requested
        ? parseConsumptionInput(input.consumptions?.[materialId])
        : previous?.consumption && isRecordedConsumption(previous.consumption)
          ? previous.consumption
          : BOM_CONSUMPTION_PENDING;
      return {
        id: createId(),
        styleVersionId: target.id,
        materialId,
        consumption,
        unit: previous?.unit ?? material.unit,
        includesAllowance: previous?.includesAllowance ?? false,
        allowanceRate: previous?.allowanceRate ?? "0.03",
        colorScope: previous?.colorScope ?? "all",
        confirmed: false,
      };
    });
    await tx.bomLine.createMany({ data: nextLines });
    const details = readConstruction(target.constructionJson);
    if (details.length) await tx.styleVersion.update({ where: { id: target.id }, data: { constructionJson: JSON.stringify(details.filter(r => r.group === "process" || nextLines.some(b => b.materialId === r.materialId)).map(r => {
      const b = nextLines.find(b => b.materialId === r.materialId);
      return b ? { ...r, fields: { ...r.fields, consumption: b.consumption === "pending" ? "" : b.consumption, unit: b.unit } } : r;
    })) } });

    const recordedOral = nextLines.some((line) => isRecordedConsumption(line.consumption));
    const message = recordedOral
      ? "已记录工厂口头单耗，未签字，未覆盖已批准版本，不能投产。"
      : createdDraft
        ? "已写入资料草稿，未覆盖已批准版本，用量待工厂确认，不能投产。"
        : "已更新资料草稿中的面辅料，未覆盖已批准版本，不能投产。";

    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "style_bom.draft_saved",
        entityType: "StyleVersion",
        entityId: target.id,
        summary: message,
        payloadJson: JSON.stringify({
          styleId: style.id,
          versionNumber: target.versionNumber,
          createdDraft,
          materialIds,
          recordedOral,
          before: latestDraft?.bomLines ?? [], after: nextLines, constructionBefore: details, constructionAfter: (await tx.styleVersion.findUniqueOrThrow({ where: { id: target.id } })).constructionJson,
        }),
      },
    });

    return {
      styleId: style.id,
      versionId: target.id,
      versionNumber: target.versionNumber,
      versionStatus: "draft" as const,
      createdDraft,
      materialIds,
      message,
    };
  });
}
