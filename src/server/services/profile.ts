import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { writeAudit } from "@/server/services/intake";
import { deletePrivateFile, putPrivateFile, readPrivateFile } from "@/server/storage/local";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileError";
  }
}

export function avatarSrc(avatarPath: string) {
  if (!avatarPath) return "";
  const file = avatarPath.split("/").pop() ?? "avatar";
  const stamp = file.replace(/\D/g, "").slice(-8) || "1";
  return `/api/me/avatar?v=${stamp}`;
}

export async function getUserProfile(userId: string, organizationId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId, active: true },
    select: { id: true, name: true, email: true, role: true, avatarPath: true },
  });
  if (!user) throw new ProfileError("账号不存在");
  return {
    ...user,
    avatarSrc: avatarSrc(user.avatarPath),
  };
}

export async function updateDisplayName(input: { userId: string; organizationId: string; name: string }) {
  const name = input.name.trim();
  if (!name) throw new ProfileError("显示名不能空");
  if (name.length > 40) throw new ProfileError("显示名太长");
  const current = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId, active: true },
    select: { id: true, name: true },
  });
  if (!current) throw new ProfileError("账号不存在");
  if (current.name !== name) {
    await prisma.user.update({ where: { id: current.id }, data: { name } });
    await writeAudit({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "update_profile",
      entityType: "User",
      entityId: input.userId,
      summary: `已改显示名为 ${name}。不是改角色，也不是改登录邮箱。`,
    });
  }
  return getUserProfile(input.userId, input.organizationId);
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

export async function replaceAvatar(input: {
  userId: string;
  organizationId: string;
  bytes: Buffer;
}) {
  if (input.bytes.length > AVATAR_MAX_BYTES) throw new ProfileError("头像不能超过 5MB");
  const kind = sniffImage(input.bytes);
  if (!kind) throw new ProfileError("只接受 JPG 或 PNG，不识人");
  const current = await prisma.user.findFirst({
    where: { id: input.userId, organizationId: input.organizationId, active: true },
    select: { avatarPath: true },
  });
  if (!current) throw new ProfileError("账号不存在");
  const relativePath = `avatars/${input.organizationId}/${input.userId}-${createId()}.${kind.ext}`;
  await putPrivateFile(relativePath, input.bytes);
  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: input.userId, organizationId: input.organizationId, active: true, avatarPath: current.avatarPath },
        data: { avatarPath: relativePath },
      });
      if (changed.count !== 1) throw new ProfileError("头像已变化，请刷新后重试");
      await writeAudit({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "update_profile",
        entityType: "User",
        entityId: input.userId,
        summary: "已换个人头像。不是识人，也不是改角色。",
      }, tx);
    });
  } catch (error) {
    await deletePrivateFile(relativePath).catch(() => undefined);
    throw error;
  }
  if (current.avatarPath) await deletePrivateFile(current.avatarPath).catch(() => undefined);
  return getUserProfile(input.userId, input.organizationId);
}

export async function readAvatar(userId: string, organizationId: string) {
  const profile = await getUserProfile(userId, organizationId);
  if (!profile.avatarPath) throw new ProfileError("还没有头像");
  const bytes = await readPrivateFile(profile.avatarPath);
  const mime = profile.avatarPath.endsWith(".png") ? "image/png" : "image/jpeg";
  return { bytes, mime };
}
