import path from "node:path";
import { prisma } from "@/lib/db";
import { visionConfigured } from "@/lib/ai-config";
import { createId, sha256, sha256Bytes } from "@/lib/hash";
import { demoNow } from "@/lib/clock";
import { visionFixtureForBytes } from "@/lib/vision-fixtures";
import { writeAudit } from "@/server/services/intake";
import { putPrivateFile, readPrivateFile } from "@/server/storage/local";
import {
  extractCsv,
  extractTextPdf,
  extractXlsx,
  looksLikeCsv,
  TabularExtractError,
} from "@/server/services/tabular-extract";

export const INBOX_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class InboxAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxAttachmentError";
  }
}

type SniffedKind =
  | { ext: "png"; mime: "image/png" }
  | { ext: "jpg"; mime: "image/jpeg" }
  | { ext: "pdf"; mime: "application/pdf" }
  | { ext: "xlsx"; mime: typeof XLSX_MIME }
  | { ext: "csv"; mime: "text/csv" };

function sniffAttachment(bytes: Buffer, filename: string): SniffedKind | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png", mime: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    return { ext: "pdf", mime: "application/pdf" };
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("latin1") === "PK") {
    return { ext: "xlsx", mime: XLSX_MIME };
  }
  if (looksLikeCsv(filename, bytes)) {
    return { ext: "csv", mime: "text/csv" };
  }
  return null;
}

function safeFilename(name?: string) {
  const base = path.basename(name || "attachment").replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  return base.slice(0, 120) || "attachment";
}

export function isInboxStoredMime(mimeType: string) {
  return (
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "application/pdf" ||
    mimeType === "text/csv" ||
    mimeType === XLSX_MIME
  );
}

export function isInboxBinaryMime(mimeType: string) {
  return isInboxStoredMime(mimeType);
}

export function inboxAttachmentNote(filename: string) {
  const vision = visionConfigured()
    ? "视觉识别尚未接通，未进行语义识别，未提取 BOM。"
    : "未配置视觉模型，未进行语义识别，未提取 BOM。";
  return `附件：${filename}\n已保存。${vision}不能按图识款，也不能把图片当成生产依据。`;
}

function resolveExtracted(kind: SniffedKind, bytes: Buffer, filename: string) {
  if (kind.ext === "csv") {
    const extracted = extractCsv(bytes, filename);
    return { origin: "inbox-tabular", rawText: extracted.text, summary: "已保存 CSV 并提取可定位单元格" };
  }
  if (kind.ext === "xlsx") {
    const extracted = extractXlsx(bytes, filename);
    return { origin: "inbox-tabular", rawText: extracted.text, summary: "已保存 XLSX 并提取可定位单元格" };
  }
  if (kind.ext === "pdf") {
    const extracted = extractTextPdf(bytes, filename);
    if (extracted) {
      return { origin: "inbox-pdf", rawText: extracted.text, summary: "已保存文字 PDF 并提取可定位片段" };
    }
    return { origin: "inbox-upload", rawText: inboxAttachmentNote(filename), summary: "已保存图片/扫描PDF附件，未识款，未提取 BOM" };
  }
  const fixture = visionFixtureForBytes(bytes);
  if (fixture) {
    return {
      origin: "inbox-upload",
      rawText: fixture.text,
      summary: "已保存内置 fixture 演示图，按公开文本解析，不是视觉识款",
    };
  }
  return { origin: "inbox-upload", rawText: inboxAttachmentNote(filename), summary: "已保存图片/扫描PDF附件，未识款，未提取 BOM" };
}

export async function ingestInboxAttachment(input: {
  organizationId: string;
  userId: string;
  bytes: Buffer;
  filename?: string;
  declaredMime?: string;
}) {
  if (!input.bytes.length) throw new InboxAttachmentError("请选择 JPG、PNG、PDF、CSV 或 XLSX");
  if (input.bytes.length > INBOX_ATTACHMENT_MAX_BYTES) throw new InboxAttachmentError("附件超过 5MB");
  const filename = safeFilename(input.filename);
  const kind = sniffAttachment(input.bytes, filename);
  if (!kind) throw new InboxAttachmentError("只接受 JPG、PNG、PDF、CSV 或 XLSX，未进行识款");

  const contentHash = sha256(`${input.organizationId}:bytes:${sha256Bytes(input.bytes)}`);
  const existing = await prisma.sourceDocument.findUnique({
    where: {
      organizationId_contentHash: {
        organizationId: input.organizationId,
        contentHash,
      },
    },
  });
  if (existing) {
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "source.duplicate_detected",
      entityType: "SourceDocument",
      entityId: existing.id,
      summary: "重复提交同一附件，未新建来源，也未创建订单",
    });
    return {
      source: existing,
      alreadyExisted: true,
      recognized: false as const,
      extractedBom: false as const,
    };
  }

  let extracted;
  try {
    extracted = resolveExtracted(kind, input.bytes, filename);
  } catch (error) {
    const message = error instanceof TabularExtractError ? error.message : "无法读取该文件，请另存为 CSV";
    throw new InboxAttachmentError(message);
  }

  const sourceId = createId();
  const stamp = sha256Bytes(input.bytes).slice(0, 16);
  const storagePath = `inbox/${input.organizationId}/${sourceId}-${stamp}.${kind.ext}`;
  await putPrivateFile(storagePath, input.bytes);
  const source = await prisma.sourceDocument.create({
    data: {
      id: sourceId,
      organizationId: input.organizationId,
      contentHash,
      origin: extracted.origin,
      filename,
      mimeType: kind.mime,
      rawText: extracted.rawText,
      storagePath,
      receivedAt: demoNow(),
      parseStatus: "queued",
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "source.ingested",
    entityType: "SourceDocument",
    entityId: source.id,
    summary: extracted.summary,
  });
  return {
    source,
    alreadyExisted: false,
    recognized: false as const,
    extractedBom: false as const,
  };
}

export async function readInboxAttachment(input: { organizationId: string; sourceId: string }) {
  const source = await prisma.sourceDocument.findFirst({
    where: { id: input.sourceId, organizationId: input.organizationId },
  });
  if (!source) throw new InboxAttachmentError("来源不存在或不属于当前组织");
  if (!source.storagePath || !isInboxStoredMime(source.mimeType)) {
    throw new InboxAttachmentError("该来源不是可预览附件");
  }
  const bytes = await readPrivateFile(source.storagePath);
  return { bytes, mime: source.mimeType, filename: source.filename };
}
