import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getUserProfile, ProfileError, replaceAvatar, updateDisplayName } from "@/server/services/profile";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const GIF_STUB = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");
const JPEG_STUB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-profile-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("个人资料", () => {
  it("本人可改显示名，空名拒绝，不是改角色", async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.userManager },
      select: { role: true, email: true },
    });
    const updated = await updateDisplayName({
      userId: IDS.userManager,
      organizationId: IDS.orgDemo,
      name: " 周衡本人 ",
    });
    expect(updated.name).toBe("周衡本人");
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: IDS.userManager },
      select: { name: true, role: true, email: true },
    });
    expect(after.name).toBe("周衡本人");
    expect(after.role).toBe(before.role);
    expect(after.email).toBe(before.email);
    await expect(
      updateDisplayName({
        userId: IDS.userManager,
        organizationId: IDS.orgDemo,
        name: "   ",
      }),
    ).rejects.toBeInstanceOf(ProfileError);
  });

  it("本人可换 PNG 头像，GIF 拒绝，卡片走私有地址", async () => {
    const profile = await replaceAvatar({
      userId: IDS.userSales,
      organizationId: IDS.orgDemo,
      bytes: PNG_1X1,
    });
    expect(profile.avatarSrc).toMatch(/^\/api\/me\/avatar\?v=/);
    expect(profile.avatarPath.startsWith(`avatars/${IDS.orgDemo}/${IDS.userSales}-`)).toBe(true);
    const stored = readFileSync(path.join(uploadRoot, profile.avatarPath));
    expect(stored.equals(PNG_1X1)).toBe(true);
    const read = await getUserProfile(IDS.userSales, IDS.orgDemo);
    expect(read.avatarPath).toBe(profile.avatarPath);
    await expect(
      replaceAvatar({
        userId: IDS.userSales,
        organizationId: IDS.orgDemo,
        bytes: GIF_STUB,
      }),
    ).rejects.toBeInstanceOf(ProfileError);
  });

  it("头像审计写入失败时保留原头像和数据库指向", async () => {
    const original = await replaceAvatar({ userId: IDS.userSales, organizationId: IDS.orgDemo, bytes: PNG_1X1 });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_avatar_audit BEFORE INSERT ON "AuditEvent" WHEN NEW.action = 'update_profile' BEGIN SELECT RAISE(ABORT, 'audit blocked'); END`);
    try {
      await expect(replaceAvatar({ userId: IDS.userSales, organizationId: IDS.orgDemo, bytes: JPEG_STUB })).rejects.toThrow();
      expect((await getUserProfile(IDS.userSales, IDS.orgDemo)).avatarPath).toBe(original.avatarPath);
      expect(readFileSync(path.join(uploadRoot, original.avatarPath)).equals(PNG_1X1)).toBe(true);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_avatar_audit`);
    }
  });
});
