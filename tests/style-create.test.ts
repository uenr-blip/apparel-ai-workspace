import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createStyleMaster } from "@/server/services/style-create";
import { getStyleThread, listStyleSummaries } from "@/server/services/style-thread";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-style-create-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("新建款式主档", () => {
  it("人手建档只要款号款名，不必先填品牌品类年份，不识款", async () => {
    const before = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const result = await createStyleMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "ST-NEW-01",
      name: "新开圆领",
      bytes: PNG_1X1,
      filename: "front.png",
    });
    expect(result.styleCode).toBe("ST-NEW-01");
    expect(result.recognized).toBe(false);
    expect(result.message).toContain("资料未齐");
    expect(result.message).not.toContain("标准工时");

    expect(await prisma.style.count({ where: { organizationId: IDS.orgDemo } })).toBe(before + 1);
    const style = await prisma.style.findFirstOrThrow({
      where: { organizationId: IDS.orgDemo, code: "ST-NEW-01" },
      include: { versions: true },
    });
    expect(style.name).toBe("新开圆领");
    expect(style.category).toBe("未填写");
    expect(style.silhouette).toBe("未填写");
    expect(style.status).toBe("draft");
    expect(style.imagePath.startsWith("/")).toBe(false);
    expect(style.versions).toHaveLength(1);
    expect(style.versions[0]?.status).toBe("draft");
    expect(style.versions[0]?.processNotes).toBe("");

    const list = await listStyleSummaries(IDS.orgDemo);
    expect(list.some((row) => row.code === "ST-NEW-01")).toBe(true);
    const thread = await getStyleThread(IDS.orgDemo, style.id);
    expect(thread.stages.some((row) => row.kind === "spec_version" && row.facts.join(" ").includes("未记工艺说明"))).toBe(true);
  });

  it("款号重复、工厂、外组织都不能建档", async () => {
    await expect(
      createStyleMaster({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        code: "ST-26018",
        name: "撞号",
      }),
    ).rejects.toThrow("款号已存在");

    await expect(
      createStyleMaster({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        code: "ST-FAC-01",
        name: "工厂建档",
      }),
    ).rejects.toThrow("无权");

    const iso = await createStyleMaster({
      organizationId: IDS.orgIso,
      userId: IDS.userIso,
      role: "salesperson",
      code: "ST-NEW-01",
      name: "隔离新款",
    });
    expect(iso.styleCode).toBe("ST-NEW-01");
    const demoHas = await prisma.style.findFirst({
      where: { organizationId: IDS.orgDemo, code: "ST-NEW-01" },
    });
    expect(demoHas).toBeNull();
  });
});
