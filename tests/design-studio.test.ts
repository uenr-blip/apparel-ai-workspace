import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDS, ROLES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  adoptDesignDraft,
  attachDesignAsset,
  bindDesignStyle,
  createDesignProject,
  DesignStudioError,
  editDesignRound,
  generateDesignRound,
  selectDesignVariants,
} from "@/server/services/design-studio";
import { resetDatabase } from "./helpers";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const sales = {
  organizationId: IDS.orgDemo,
  userId: IDS.userSales,
  role: ROLES.salesperson,
};

let uploadRoot = "";

beforeEach(async () => {
  uploadRoot = mkdtempSync(path.join(tmpdir(), "yiju-design-"));
  process.env.UPLOAD_ROOT = uploadRoot;
  process.env.AI_MODE = "mock";
  delete process.env.AI_IMAGE_MODEL;
  await resetDatabase();
});

afterEach(() => {
  rmSync(uploadRoot, { recursive: true, force: true });
});

async function stubImage() {
  return {
    images: [
      { bytes: PNG_1X1, mime: "image/png", label: "方案 A" },
      { bytes: PNG_1X1, mime: "image/png", label: "方案 B" },
    ],
    provider: "test-stub",
    model: "stub-image",
  };
}

describe("AI设计工作台", () => {
  it("无正式款号也可开草案，未配置图像模型时不得假生成", async () => {
    const project = await createDesignProject({
      ...sales,
      name: "夏季卫衣草案",
      brief: "袋鼠袋，保留原领型",
    });
    expect(project.code).toMatch(/^DES-/);
    expect(project.styleId).toBeNull();
    await expect(
      generateDesignRound({
        ...sales,
        projectId: project.id,
        prompt: "生成两款配色",
      }),
    ).rejects.toThrow(/真实图像模型未启用|不能用假图冒充/);
    const rounds = await prisma.designRound.count({ where: { projectId: project.id } });
    expect(rounds).toBe(0);

    const bound = await bindDesignStyle({
      ...sales,
      projectId: project.id,
      styleId: IDS.styleSt26018,
    });
    expect(bound.styleCode).toBe("ST-26018");
    expect(bound.styleImageSrc).toBeTruthy();
    await expect(
      bindDesignStyle({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: ROLES.factory,
        projectId: project.id,
        styleId: IDS.styleSt26018,
      }),
    ).rejects.toBeInstanceOf(DesignStudioError);
  });

  it("真实生成后可定向修改、比较选定，转入开发款式且不采购", async () => {
    const project = await createDesignProject({
      ...sales,
      name: "口袋改色",
      styleId: IDS.styleSt26018,
      materialId: IDS.materialMat001,
    });
    expect(project.styleCode).toBe("ST-26018");
    await attachDesignAsset({
      ...sales,
      projectId: project.id,
      bytes: PNG_1X1,
      label: "客户色卡",
    });
    const generated = await generateDesignRound({
      ...sales,
      projectId: project.id,
      prompt: "只改袋鼠袋颜色，其余保持",
      provider: stubImage,
    });
    expect(generated.rounds[0]?.mode).toBe("mock");
    expect(generated.rounds[0]?.variants).toHaveLength(2);
    const firstIds = generated.rounds[0].variants.map((item) => item.id);
    await selectDesignVariants({ ...sales, projectId: project.id, variantIds: [firstIds[0]] });
    const edited = await editDesignRound({
      ...sales,
      projectId: project.id,
      instruction: "袋改短袖橙",
      provider: stubImage,
    });
    expect(edited.rounds[0]?.kind).toBe("edit");
    const editIds = edited.rounds[0].variants.map((item) => item.id);
    await selectDesignVariants({ ...sales, projectId: project.id, variantIds: [editIds[0], firstIds[0]] });

    const approvedBefore = await prisma.styleVersion.count({
      where: { styleId: IDS.styleSt26018, status: "approved" },
    });
    const purchaseBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const adopted = await adoptDesignDraft({
      ...sales,
      projectId: project.id,
      target: "development",
    });
    expect(adopted.developmentProjectId).toBeTruthy();
    const development = await prisma.developmentProject.findFirstOrThrow({
      where: { id: adopted.developmentProjectId! },
    });
    expect(development.styleId).toBe(IDS.styleSt26018);
    expect(development.code).toMatch(/^DEV-DES-/);
    const adoptionAudit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: project.id, action: "design.draft.adopted" } });
    expect(adoptionAudit.actorUserId).toBe(sales.userId);
    expect(JSON.parse(adoptionAudit.payloadJson!).after.status).toBe("adopted");
    await expect(selectDesignVariants({ ...sales, projectId: project.id, variantIds: [] })).rejects.toThrow(/已采用|已转入开发/);
    const approvedAfter = await prisma.styleVersion.count({
      where: { styleId: IDS.styleSt26018, status: "approved" },
    });
    expect(approvedAfter).toBe(approvedBefore);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(purchaseBefore);
    const task = await prisma.taskItem.findFirst({
      where: { kind: "design_draft_review", relatedStyleId: IDS.styleSt26018 },
    });
    expect(task?.status).toBe("open");
  });

  it("转入款式只新建资料草稿，不覆盖已批准版本；工厂不能开草案", async () => {
    const project = await createDesignProject({
      ...sales,
      name: "无款号新想法",
    });
    await generateDesignRound({
      ...sales,
      projectId: project.id,
      prompt: "圆领针织",
      provider: stubImage,
    });
    const snapshot = await generateDesignRound({
      ...sales,
      projectId: project.id,
      prompt: "加一条对比色",
      provider: stubImage,
    });
    await selectDesignVariants({
      ...sales,
      projectId: project.id,
      variantIds: [snapshot.rounds[0].variants[0].id],
    });
    const adopted = await adoptDesignDraft({
      ...sales,
      projectId: project.id,
      target: "style",
    });
    const style = await prisma.style.findFirstOrThrow({ where: { id: adopted.styleId! } });
    expect(style.code).toBe(project.code);
    expect(style.status).toBe("development");
    const versions = await prisma.styleVersion.findMany({ where: { styleId: style.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.status).toBe("draft");
    const attachments = await prisma.styleVersionAttachment.findMany({
      where: { styleVersionId: versions[0]!.id },
    });
    expect(attachments[0]?.kind).toBe("design");
    expect(readFileSync(path.join(uploadRoot, attachments[0]!.storagePath)).length).toBeGreaterThan(0);

    const ontoStyle = await createDesignProject({
      ...sales,
      name: "改袋不改主档",
      styleId: IDS.styleSt26018,
    });
    await generateDesignRound({
      ...sales,
      projectId: ontoStyle.id,
      prompt: "只改口袋",
      provider: stubImage,
    });
    const ontoSnap = await generateDesignRound({
      ...sales,
      projectId: ontoStyle.id,
      prompt: "再出一版",
      provider: stubImage,
    });
    await selectDesignVariants({
      ...sales,
      projectId: ontoStyle.id,
      variantIds: [ontoSnap.rounds[0].variants[0].id],
    });
    const approvedKeep = await prisma.styleVersion.findMany({
      where: { styleId: IDS.styleSt26018, status: "approved" },
    });
    const adoptedOnto = await adoptDesignDraft({
      ...sales,
      projectId: ontoStyle.id,
      target: "style",
    });
    expect(adoptedOnto.styleId).toBe(IDS.styleSt26018);
    const afterVersions = await prisma.styleVersion.findMany({
      where: { styleId: IDS.styleSt26018 },
      orderBy: { versionNumber: "asc" },
    });
    expect(afterVersions.filter((item) => item.status === "approved").map((item) => item.id)).toEqual(
      approvedKeep.map((item) => item.id),
    );
    expect(afterVersions.at(-1)?.status).toBe("draft");
    expect(afterVersions.at(-1)?.id).toBe(adoptedOnto.versionId);

    await expect(
      createDesignProject({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: ROLES.factory,
        name: "工厂不该开设计",
      }),
    ).rejects.toBeInstanceOf(DesignStudioError);
  });
});
