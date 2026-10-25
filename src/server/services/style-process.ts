import type { Prisma } from "@prisma/client";
import { lockOrganizationForWrite } from "./order-write";
import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId, sha256Bytes } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";
import { putPrivateFile, readPrivateFile } from "@/server/storage/local";
import { writeAudit } from "@/server/services/intake";

export const PATTERN_MAX_BYTES = 5 * 1024 * 1024;

function sniffPattern(bytes: Buffer) {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return { ext: "pdf" as const, mime: "application/pdf" as const };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

async function loadStyle(organizationId: string, styleId: string, db: Prisma.TransactionClient = prisma) {
  const style = await db.style.findFirst({
    where: { id: styleId, organizationId },
    include: { versions: { orderBy: { versionNumber: "desc" }, include: { attachments: true } } },
  });
  if (!style) throw new ExecutionError("款式不存在或不属于当前组织");
  return style;
}

async function ensureDraft(style: Awaited<ReturnType<typeof loadStyle>>, db: Prisma.TransactionClient) {
  const latestDraft = style.versions.find((version) => version.status !== "approved") ?? null;
  const latestApproved = style.versions.find((version) => version.status === "approved") ?? null;
  const template = latestDraft ?? latestApproved ?? style.versions[0];
  if (latestDraft) return { target: latestDraft, createdDraft: false, template };
  const maxVersion = style.versions[0]?.versionNumber ?? 0;
  const target = await db.styleVersion.create({
    data: {
      id: createId(),
      styleId: style.id,
      versionNumber: maxVersion + 1,
      status: "draft",
      cuffType: template?.cuffType ?? "未填写",
      specNotes: template?.specNotes ?? "",
      processNotes: template?.processNotes ?? "",
      patternRevision: template?.patternRevision ?? "",
      constructionJson: template?.constructionJson ?? "[]",
      changeSummary: "写入工艺与版次草稿，未覆盖已批准版本，不能投产",
    },
    include: { attachments: true },
  });
  if (template) {
    const bom = await db.bomLine.findMany({ where: { styleVersionId: template.id } });
    if (bom.length) await db.bomLine.createMany({ data: bom.map(line => ({ ...line, id: createId(), styleVersionId: target.id, confirmed: false })) });
    if (template.attachments.length) await db.styleVersionAttachment.createMany({ data: template.attachments.map(file => ({ ...file, id: createId(), styleVersionId: target.id })) });
  }
  return { target, createdDraft: true, template };
}

export async function saveStyleProcessDraft(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  processNotes: string;
  patternRevision: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.saveStyleProcessDraft)) {
    throw new ExecutionError("无权写入工艺与版次草稿");
  }
  return prisma.$transaction(async db => {
  await lockOrganizationForWrite(db, input.organizationId);
  if (!await db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true, role: input.role } })) throw new ExecutionError("当前账号无权修改资料");
  const style = await loadStyle(input.organizationId, input.styleId, db);
  const { target, createdDraft } = await ensureDraft(style, db);
  const processNotes = input.processNotes.trim();
  const patternRevision = input.patternRevision.trim();
  await db.styleVersion.update({
    where: { id: target.id },
    data: {
      processNotes,
      patternRevision,
      changeSummary: "写入工艺与版次草稿，未覆盖已批准版本，不能投产",
    },
  });
  const message = createdDraft
    ? "已写入工艺与版次到新草稿，未覆盖已批准版本，不能投产。"
    : "已更新资料草稿中的工艺与版次，未覆盖已批准版本，不能投产。";
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style_process.draft_saved",
    entityType: "StyleVersion",
    entityId: target.id,
    summary: message,
    payloadJson: JSON.stringify({
      actionType: ACTION_TYPES.saveStyleProcessDraft,
      styleId: style.id,
      versionNumber: target.versionNumber,
      createdDraft, before: { processNotes: target.processNotes, patternRevision: target.patternRevision }, after: { processNotes, patternRevision },
    }),
  }, db);
  return {
    styleId: style.id,
    versionId: target.id,
    versionNumber: target.versionNumber,
    createdDraft,
    processNotes,
    patternRevision,
    message,
  };
  });
}

export async function attachStylePatternFile(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  bytes: Buffer;
  filename?: string;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.attachStylePattern)) {
    throw new ExecutionError("无权上传版次附件");
  }
  if (!input.bytes.length) throw new ExecutionError("请选择版次文件");
  if (input.bytes.length > PATTERN_MAX_BYTES) throw new ExecutionError("附件超过 5MB");
  const kind = sniffPattern(input.bytes);
  if (!kind) throw new ExecutionError("版次附件只接受 PDF、JPG 或 PNG，不是制版系统，未识图");

  return prisma.$transaction(async db => {
  await lockOrganizationForWrite(db, input.organizationId);
  if (!await db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, active: true, role: input.role } })) throw new ExecutionError("当前账号无权修改资料");
  const style = await loadStyle(input.organizationId, input.styleId, db);
  const { target, createdDraft } = await ensureDraft(style, db);
  const stamp = sha256Bytes(input.bytes).slice(0, 16);
  const storagePath = `patterns/${style.organizationId}/${style.id}/${target.id}-${stamp}.${kind.ext}`;
  await putPrivateFile(storagePath, input.bytes);
  const attachment = await db.styleVersionAttachment.create({
    data: {
      id: createId(),
      styleVersionId: target.id,
      kind: "pattern",
      fileName: input.filename?.trim() || `pattern.${kind.ext}`,
      storagePath,
      mimeType: kind.mime,
    },
  });
  const message = createdDraft
    ? "版次附件已挂到新草稿，不是制版系统，未覆盖已批准版本。"
    : "版次附件已挂到资料草稿，不是制版系统，未覆盖已批准版本。";
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style_pattern.attached",
    entityType: "StyleVersionAttachment",
    entityId: attachment.id,
    summary: message,
    payloadJson: JSON.stringify({
      actionType: ACTION_TYPES.attachStylePattern,
      styleId: style.id,
      versionId: target.id,
      recognized: false, before: null, after: attachment,
    }),
  }, db);
  return {
    styleId: style.id,
    versionId: target.id,
    attachmentId: attachment.id,
    fileName: attachment.fileName,
    recognized: false as const,
    createdDraft,
    message,
  };
  });
}

export async function readStylePatternFile(input: {
  organizationId: string;
  styleId: string;
  attachmentId: string;
}) {
  const style = await loadStyle(input.organizationId, input.styleId);
  const attachment = style.versions.flatMap((version) => version.attachments).find((item) => item.id === input.attachmentId);
  if (!attachment) throw new ExecutionError("版次附件不存在");
  const bytes = await readPrivateFile(attachment.storagePath);
  return { bytes, mime: attachment.mimeType, fileName: attachment.fileName };
}
