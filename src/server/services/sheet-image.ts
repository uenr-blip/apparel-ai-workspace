import { createId, sha256Bytes } from "@/lib/hash";
import { putPrivateFile, readPrivateFile, deletePrivateFile } from "@/server/storage/local";
import { prisma } from "@/lib/db";
import { ExecutionError } from "@/server/services/execution";

const MAX_BYTES = 5 * 1024 * 1024;

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png" as const, mime: "image/png" as const };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg" as const, mime: "image/jpeg" as const };
  }
  return null;
}

export async function storeSheetImage(organizationId: string, bytes: Buffer, actorUserId?: string) {
  if (actorUserId && !await prisma.user.findFirst({where:{id:actorUserId,organizationId,active:true,role:{in:["manager","salesperson"]}}})) throw new ExecutionError("当前账号无权上传版单图片");
  if (!bytes.length) throw new ExecutionError("请选择 JPG 或 PNG");
  if (bytes.length > MAX_BYTES) throw new ExecutionError("图片超过 5MB");
  const kind = sniffImage(bytes);
  if (!kind) throw new ExecutionError("只接受 JPG 或 PNG");
  const id = `${createId()}-${sha256Bytes(bytes).slice(0, 8)}`;
  await putPrivateFile(`sheets/${organizationId}/${id}.${kind.ext}`, bytes);
  if (actorUserId) {
    try { await prisma.auditEvent.create({data:{id:createId(),organizationId,actorUserId,actorType:"user",action:"pattern.image_uploaded",entityType:"SheetImage",entityId:id,summary:"上传版单或回样图片，尚未改变版单要求",payloadJson:JSON.stringify({before:null,after:{imageSrc:`/api/sheet-images/${id}`,mimeType:kind.mime,sha256:sha256Bytes(bytes)}})}}); }
    catch(e) { await deletePrivateFile(`sheets/${organizationId}/${id}.${kind.ext}`);throw e; }
  }
  return { imageSrc: `/api/sheet-images/${id}` };
}

export async function readSheetImage(organizationId: string, id: string) {
  if (!/^[\w-]{8,80}$/.test(id)) throw new ExecutionError("图片不存在");
  for (const ext of ["jpg", "png"] as const) {
    try {
      const bytes = await readPrivateFile(`sheets/${organizationId}/${id}.${ext}`);
      return { bytes, mime: ext === "png" ? "image/png" : "image/jpeg" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new ExecutionError("图片不存在");
}
