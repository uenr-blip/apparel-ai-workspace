import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/constants";
import { sha256Bytes } from "@/lib/hash";
import { styleImageSrc } from "@/lib/style-image";
import { writeAudit } from "@/server/services/intake";
import { deletePrivateFile, putPrivateFile, readPrivateFile } from "@/server/storage/local";

export const STYLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PUBLIC_STYLE_IMAGE = /^\/styles\/[a-z0-9.-]+\.(svg|png|jpe?g)$/i;

export class StyleImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleImageError";
  }
}

export { styleImageSrc };

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

function publicMime(imagePath: string) {
  if (imagePath.endsWith(".svg")) return "image/svg+xml";
  if (imagePath.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

export async function replaceStyleImage(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  bytes: Buffer;
  filename?: string;
  declaredMime?: string;
}) {
  if (input.role === ROLES.factory) throw new StyleImageError("无权更换款式图");
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new StyleImageError("款式不存在或不属于当前组织");
  if (!input.bytes.length) throw new StyleImageError("请选择 JPG 或 PNG");
  if (input.bytes.length > STYLE_IMAGE_MAX_BYTES) throw new StyleImageError("图片超过 5MB");
  const kind = sniffImage(input.bytes);
  if (!kind) throw new StyleImageError("只接受 JPG 或 PNG，未进行识款");

  const stamp = sha256Bytes(input.bytes).slice(0, 16);
  const relativePath = `styles/${style.organizationId}/${style.id}-${stamp}.${kind.ext}`;
  await putPrivateFile(relativePath, input.bytes);
  const message = `款号 ${style.code} 已换图，未识款，不是新款`;
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.style.updateMany({
        where: { id: style.id, organizationId: input.organizationId, imagePath: style.imagePath },
        data: { imagePath: relativePath },
      });
      if (changed.count !== 1) throw new StyleImageError("款式图已变化，请刷新后重试");
      await writeAudit({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "style.image.replaced",
        entityType: "Style",
        entityId: style.id,
        summary: message,
      }, tx);
    });
  } catch (error) {
    if (relativePath !== style.imagePath) await deletePrivateFile(relativePath).catch(() => undefined);
    throw error;
  }
  if (!style.imagePath.startsWith("/") && style.imagePath !== relativePath) {
    await deletePrivateFile(style.imagePath).catch(() => undefined);
  }
  return {
    styleId: style.id,
    styleCode: style.code,
    imagePath: relativePath,
    imageSrc: styleImageSrc({ id: style.id, imagePath: relativePath }),
    recognized: false as const,
    message,
  };
}

export async function readStyleImage(input: { organizationId: string; styleId: string }) {
  const style = await prisma.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new StyleImageError("款式不存在或不属于当前组织");
  if (style.imagePath.startsWith("/")) {
    if (!PUBLIC_STYLE_IMAGE.test(style.imagePath)) throw new StyleImageError("款式图路径无效");
    const absolute = path.join(process.cwd(), "public", style.imagePath.replace(/^\//, ""));
    const bytes = await readFile(absolute);
    return { bytes, mime: publicMime(style.imagePath) };
  }
  const bytes = await readPrivateFile(style.imagePath);
  const mime = style.imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return { bytes, mime };
}
