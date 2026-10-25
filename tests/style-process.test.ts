import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { assertCannotReleaseToProduction } from "@/server/services/execution";
import { attachStylePatternFile, saveStyleProcessDraft } from "@/server/services/style-process";
import { getStyleThread } from "@/server/services/style-thread";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-style-process-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

describe("资料版本上的工艺与版次", () => {
  it("未记工艺说明时链上标明不能当生产依据，不编标准工时，不另开菜单", async () => {
    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    const spec = thread.stages.find((row) => row.kind === "spec_version");
    expect(spec?.facts.join(" ")).toContain("未记工艺说明，不能当生产依据");
    expect(spec?.facts.join(" ")).toContain("未附版次文件，不是制版系统");
    expect(JSON.stringify(thread)).not.toContain("标准工时");
    expect(JSON.stringify(thread)).not.toContain("工艺管理");
    expect(JSON.stringify(thread)).not.toContain("制版管理");
  });

  it("写入工艺说明和版次只落新草稿，不覆盖已批准 V1", async () => {
    const v1 = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(v1.status).toBe("approved");

    const result = await saveStyleProcessDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      processNotes: "圆领罗纹领，肩缝先合后套。不是工时库。",
      patternRevision: "P2",
    });
    expect(result.createdDraft).toBe(true);
    expect(result.versionNumber).toBeGreaterThan(v1.versionNumber);
    expect(result.message).toContain("未覆盖已批准版本");
    expect(result.message).not.toContain("标准工时");

    const afterV1 = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(afterV1.processNotes).toBe(v1.processNotes);
    expect(afterV1.status).toBe("approved");

    const draft = await prisma.styleVersion.findFirst({
      where: { styleId: IDS.styleSt26018, status: "draft" },
    });
    expect(draft?.processNotes).toContain("圆领罗纹领");
    expect(draft?.patternRevision).toBe("P2");

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    const draftStage = thread.stages.find((row) => row.kind === "spec_version" && row.statusLabel === "草稿");
    expect(draftStage?.facts.join(" ")).toContain("工艺说明已记，不是标准工时");
    expect(draftStage?.facts.join(" ")).toContain("版次 P2");
  });

  it("版次附件挂在草稿上，不识图、不做 CAD；工厂和外组织不能写", async () => {
    const saved = await attachStylePatternFile({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      styleId: IDS.styleSt26018,
      bytes: PNG_1X1,
      filename: "p2-block.png",
    });
    expect(saved.recognized).toBe(false);
    expect(saved.message).toContain("不是制版系统");

    const draft = await prisma.styleVersion.findFirst({
      where: { styleId: IDS.styleSt26018, status: "draft" },
      include: { attachments: true },
    });
    expect(draft?.attachments).toHaveLength(1);
    expect(draft?.attachments[0]?.kind).toBe("pattern");
    const v1 = await prisma.styleVersion.findUniqueOrThrow({
      where: { id: IDS.versionSt26018V1 },
      include: { attachments: true },
    });
    expect(v1.attachments).toHaveLength(0);

    await expect(
      saveStyleProcessDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        styleId: IDS.styleSt26018,
        processNotes: "工厂改工艺",
        patternRevision: "P9",
      }),
    ).rejects.toThrow("无权");

    await expect(
      attachStylePatternFile({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        bytes: PNG_1X1,
        filename: "x.png",
      }),
    ).rejects.toThrow("款式不存在");
  });

  it("未记工艺说明时仍不能批准投产", async () => {
    await expect(assertCannotReleaseToProduction(IDS.orderHistorical)).rejects.toThrow("不能批准投产");
  });
});
