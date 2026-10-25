import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createMaterialMaster } from "@/server/services/material-create";
import { readMaterialImage, replaceMaterialImage } from "@/server/services/material-image";
import { getMaterialRecord } from "@/server/services/material-record";
import { listMaterialShelf } from "@/server/services/material-shelf";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_STUB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const GIF_STUB = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-material-image-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("材料色卡图", () => {
  it("同一条辅料换 PNG，不识料，卡片走私有地址，不是库存", async () => {
    const created = await createMaterialMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "TRIM-PHOTO-01",
      name: "四眼扣色卡",
      kind: "trim",
      unit: "pcs",
    });

    const result = await replaceMaterialImage({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      materialId: created.materialId,
      bytes: PNG_1X1,
    });

    expect(result.recognized).toBe(false);
    expect(result.materialCode).toBe("TRIM-PHOTO-01");
    expect(result.message).toContain("未识料");
    expect(result.message).toContain("不是库存");
    expect(result.imageSrc).toMatch(new RegExp(`^/api/materials/${created.materialId}/image`));

    const stored = readFileSync(path.join(uploadRoot, result.imagePath));
    expect(stored.equals(PNG_1X1)).toBe(true);

    const shelf = (await listMaterialShelf(IDS.orgDemo)).find((row) => row.code === "TRIM-PHOTO-01");
    expect(shelf?.imageSrc).toBe(result.imageSrc);
    expect(shelf?.kind).toBe("trim");

    const record = await getMaterialRecord(IDS.orgDemo, created.materialId);
    expect(record.imageSrc).toBe(result.imageSrc);

    const read = await readMaterialImage({ organizationId: IDS.orgDemo, materialId: created.materialId });
    expect(read.mime).toBe("image/png");
    expect(read.bytes.equals(PNG_1X1)).toBe(true);
  });

  it("JPEG 可保存；GIF、空文件、工厂、外组织拒绝", async () => {
    const created = await createMaterialMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "FAB-PHOTO-01",
      name: "斜纹色卡",
      kind: "fabric",
    });

    const jpeg = await replaceMaterialImage({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      materialId: created.materialId,
      bytes: JPEG_STUB,
    });
    expect(jpeg.imagePath.endsWith(".jpg")).toBe(true);

    await expect(
      replaceMaterialImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        materialId: created.materialId,
        bytes: GIF_STUB,
      }),
    ).rejects.toThrow("只接受 JPG 或 PNG");

    await expect(
      replaceMaterialImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        materialId: created.materialId,
        bytes: Buffer.alloc(0),
      }),
    ).rejects.toThrow("请选择 JPG 或 PNG");

    await expect(
      replaceMaterialImage({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        materialId: created.materialId,
        bytes: PNG_1X1,
      }),
    ).rejects.toThrow("无权更换材料图");

    await expect(
      replaceMaterialImage({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        materialId: created.materialId,
        bytes: PNG_1X1,
      }),
    ).rejects.toThrow("材料不存在或不属于当前组织");
  });

  it("色卡审计写入失败时保留原图和数据库指向", async () => {
    const created = await createMaterialMaster({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", code: "TRIM-ROLLBACK-01", name: "测试色卡", kind: "trim" });
    const original = await replaceMaterialImage({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", materialId: created.materialId, bytes: PNG_1X1 });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_material_audit BEFORE INSERT ON "AuditEvent" WHEN NEW.action = 'material.image.replaced' BEGIN SELECT RAISE(ABORT, 'audit blocked'); END`);
    try {
      await expect(replaceMaterialImage({ organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", materialId: created.materialId, bytes: JPEG_STUB })).rejects.toThrow();
      const material = await prisma.material.findUniqueOrThrow({ where: { id: created.materialId } });
      expect(material.imagePath).toBe(original.imagePath);
      expect(readFileSync(path.join(uploadRoot, original.imagePath)).equals(PNG_1X1)).toBe(true);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_material_audit`);
    }
  });
});
