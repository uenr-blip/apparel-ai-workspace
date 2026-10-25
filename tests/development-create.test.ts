import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createDevelopmentProject } from "@/server/services/development-create";
import { resetDatabase } from "./helpers";

describe("新建开发款式", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("人手可先于款号开项目，材料只建引用，不采购", async () => {
    const materialsBefore = await prisma.material.count({ where: { organizationId: IDS.orgDemo } });
    const purchaseBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const result = await createDevelopmentProject({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      name: "轻薄圆领针织材料开发",
      materialIds: [IDS.materialMat001],
    });
    expect(result.projectCode).toMatch(/^DEV-\d{3}$/);
    expect(result.message).toContain("可先于款号");
    expect(result.message).toContain("没有采购");

    const project = await prisma.developmentProject.findFirstOrThrow({
      where: { id: result.projectId },
      include: { candidates: true },
    });
    expect(project.styleId).toBeNull();
    expect(project.status).toBe("open");
    expect(project.candidates).toHaveLength(1);
    expect(project.candidates[0]?.copyMode).toBe("reference");
    expect(project.candidates[0]?.materialId).toBe(IDS.materialMat001);
    expect(await prisma.material.count({ where: { organizationId: IDS.orgDemo } })).toBe(materialsBefore);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(purchaseBefore);
    expect(
      await prisma.taskItem.count({
        where: { organizationId: IDS.orgDemo, note: { contains: project.code } },
      }),
    ).toBe(1);
  });

  it("可挂已有款号；工厂和外组织材料都不能建", async () => {
    const result = await createDevelopmentProject({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      name: "挂款开发",
      styleId: IDS.styleSt26018,
    });
    const project = await prisma.developmentProject.findFirstOrThrow({ where: { id: result.projectId } });
    expect(project.styleId).toBe(IDS.styleSt26018);
    expect(result.message).toContain("材料仅为引用");

    await expect(
      createDevelopmentProject({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        name: "工厂开开发",
      }),
    ).rejects.toThrow("无权新建开发款式");

    await expect(
      createDevelopmentProject({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        name: "错料",
        materialIds: ["material-not-here"],
      }),
    ).rejects.toThrow("有材料不属于当前组织");
  });
});
