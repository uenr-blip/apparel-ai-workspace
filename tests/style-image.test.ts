import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getStyleThread, listStyleSummaries } from "@/server/services/style-thread";
import { readStyleImage, replaceStyleImage, StyleImageError } from "@/server/services/style-image";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_STUB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const GIF_STUB = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-style-image-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("款式图补图换图", () => {
  it("同一条款换 PNG，不新建款、不识款、卡片改走私有地址", async () => {
    const beforeCount = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const before = await prisma.style.findUniqueOrThrow({ where: { id: IDS.styleSt26018 } });
    expect(before.imagePath).toBe("/styles/st-26018.svg");

    const result = await replaceStyleImage({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      bytes: PNG_1X1,
      filename: "sample.png",
      declaredMime: "image/png",
    });

    expect(result.recognized).toBe(false);
    expect(result.styleCode).toBe("ST-26018");
    expect(result.styleId).toBe(IDS.styleSt26018);
    expect(result.message).toContain("未识款");
    expect(result.message).toContain("不是新款");
    expect(result.imageSrc).toMatch(/^\/api\/styles\/style-st-26018\/image/);

    const after = await prisma.style.findUniqueOrThrow({ where: { id: IDS.styleSt26018 } });
    expect(after.code).toBe("ST-26018");
    expect(after.category).toBe(before.category);
    expect(after.imagePath).not.toBe("/styles/st-26018.svg");
    expect(after.imagePath.startsWith("/")).toBe(false);

    const stored = readFileSync(path.join(uploadRoot, after.imagePath));
    expect(stored.equals(PNG_1X1)).toBe(true);
    expect(await prisma.style.count({ where: { organizationId: IDS.orgDemo } })).toBe(beforeCount);

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(thread.style.imageSrc).toBe(result.imageSrc);
    const card = (await listStyleSummaries(IDS.orgDemo)).find((row) => row.id === IDS.styleSt26018);
    expect(card?.imageSrc).toBe(result.imageSrc);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "style.image.replaced", entityId: IDS.styleSt26018 },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.summary).toContain("未识款");
  });

  it("JPEG 可保存；GIF、空文件、超大文件拒绝", async () => {
    const jpeg = await replaceStyleImage({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      styleId: IDS.styleSt26018,
      bytes: JPEG_STUB,
      filename: "look.jpg",
    });
    expect(jpeg.recognized).toBe(false);
    const stored = await prisma.style.findUniqueOrThrow({ where: { id: IDS.styleSt26018 } });
    expect(readFileSync(path.join(uploadRoot, stored.imagePath)).equals(JPEG_STUB)).toBe(true);

    await expect(
      replaceStyleImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        bytes: GIF_STUB,
        filename: "x.gif",
      }),
    ).rejects.toThrow(StyleImageError);

    await expect(
      replaceStyleImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        bytes: Buffer.alloc(0),
        filename: "empty.png",
      }),
    ).rejects.toThrow("请选择 JPG 或 PNG");

    await expect(
      replaceStyleImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        bytes: Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024)]),
        filename: "huge.png",
      }),
    ).rejects.toThrow("图片超过 5MB");
  });

  it("款式图审计写入失败时保留原图和数据库指向", async () => {
    const original = await replaceStyleImage({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", styleId: IDS.styleSt26018, bytes: PNG_1X1 });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_style_audit BEFORE INSERT ON "AuditEvent" WHEN NEW.action = 'style.image.replaced' BEGIN SELECT RAISE(ABORT, 'audit blocked'); END`);
    try {
      await expect(replaceStyleImage({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", styleId: IDS.styleSt26018, bytes: JPEG_STUB })).rejects.toThrow();
      const style = await prisma.style.findUniqueOrThrow({ where: { id: IDS.styleSt26018 } });
      expect(style.imagePath).toBe(original.imagePath);
      expect(readFileSync(path.join(uploadRoot, original.imagePath)).equals(PNG_1X1)).toBe(true);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_style_audit`);
    }
  });

  it("工厂和外组织不能换图或读图", async () => {
    await expect(
      replaceStyleImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        styleId: IDS.styleSt26018,
        bytes: PNG_1X1,
        filename: "x.png",
      }),
    ).rejects.toThrow("无权更换款式图");

    await expect(
      replaceStyleImage({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        bytes: PNG_1X1,
        filename: "x.png",
      }),
    ).rejects.toThrow("款式不存在或不属于当前组织");

    await replaceStyleImage({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      bytes: PNG_1X1,
      filename: "x.png",
    });

    await expect(readStyleImage({ organizationId: IDS.orgIso, styleId: IDS.styleSt26018 })).rejects.toThrow(
      "款式不存在或不属于当前组织",
    );
    const allowed = await readStyleImage({ organizationId: IDS.orgDemo, styleId: IDS.styleSt26018 });
    expect(allowed.mime).toBe("image/png");
    expect(allowed.bytes.equals(PNG_1X1)).toBe(true);
  });
});
