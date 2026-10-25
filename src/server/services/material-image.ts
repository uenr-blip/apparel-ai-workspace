import { prisma } from "@/lib/db";
import { ROLES } from "@/lib/constants";
import { sha256Bytes } from "@/lib/hash";
import { materialImageSrc } from "@/lib/material-image";
import { writeAudit } from "@/server/services/intake";
import { deletePrivateFile, putPrivateFile, readPrivateFile } from "@/server/storage/local";

export const MATERIAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export class MaterialImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialImageError";
  }
}

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

export async function replaceMaterialImage(input: {
  organizationId: string;
  userId: string;
  role: string;
  materialId: string;
  bytes: Buffer;
}) {
  if (input.role === ROLES.factory) throw new MaterialImageError("无权更换材料图");
  const material = await prisma.material.findFirst({
    where: { id: input.materialId, organizationId: input.organizationId },
  });
  if (!material) throw new MaterialImageError("材料不存在或不属于当前组织");
  if (!input.bytes.length) throw new MaterialImageError("请选择 JPG 或 PNG");
  if (input.bytes.length > MATERIAL_IMAGE_MAX_BYTES) throw new MaterialImageError("图片超过 5MB");
  const kind = sniffImage(input.bytes);
  if (!kind) throw new MaterialImageError("只接受 JPG 或 PNG，未进行识料");

  const stamp = sha256Bytes(input.bytes).slice(0, 16);
  const relativePath = `materials/${material.organizationId}/${material.id}-${stamp}.${kind.ext}`;
  await putPrivateFile(relativePath, input.bytes);
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.material.updateMany({
        where: { id: material.id, organizationId: input.organizationId, imagePath: material.imagePath },
        data: { imagePath: relativePath },
      });
      if (changed.count !== 1) throw new MaterialImageError("材料图已变化，请刷新后重试");
      await writeAudit({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "material.image.replaced",
        entityType: "Material",
        entityId: material.id,
        summary: `材料 ${material.code} 已换色卡图，未识料，不是库存`,
      }, tx);
    });
  } catch (error) {
    if (relativePath !== material.imagePath) await deletePrivateFile(relativePath).catch(() => undefined);
    throw error;
  }
  // Historical style/stage revisions may still reference the old image. Retain it.
  const message = `材料 ${material.code} 已换色卡图，未识料，不是库存`;
  return {
    materialId: material.id,
    materialCode: material.code,
    imagePath: relativePath,
    imageSrc: materialImageSrc({ id: material.id, imagePath: relativePath }),
    recognized: false as const,
    message,
  };
}

export async function readMaterialImage(input: { organizationId: string; materialId: string }) {
  const material = await prisma.material.findFirst({
    where: { id: input.materialId, organizationId: input.organizationId },
  });
  if (!material) throw new MaterialImageError("材料不存在或不属于当前组织");
  if (!material.imagePath) throw new MaterialImageError("还没有材料图");
  const bytes = await readPrivateFile(material.imagePath);
  const mime = material.imagePath.endsWith(".png") ? "image/png" : "image/jpeg";
  return { bytes, mime };
}
