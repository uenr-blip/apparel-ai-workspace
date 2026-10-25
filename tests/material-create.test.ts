import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createMaterialMaster, updateMaterialCard } from "@/server/services/material-create";
import { listMaterialShelf } from "@/server/services/material-shelf";
import { resetDatabase } from "./helpers";

describe("新建材料主档", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("人手建档只要编码名称种类，不按客户文件夹，不假装已采购", async () => {
    const before = await prisma.material.count({ where: { organizationId: IDS.orgDemo } });
    const result = await createMaterialMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "MAT-NEW-01",
      name: "新开罗纹",
      kind: "trim",
      specSummary: "2cm罗纹",
      unit: "m",
    });
    expect(result.materialCode).toBe("MAT-NEW-01");
    expect(result.message).toContain("不是库存");
    expect(result.message).toContain("不是已采购");

    expect(await prisma.material.count({ where: { organizationId: IDS.orgDemo } })).toBe(before + 1);
    const shelf = await listMaterialShelf(IDS.orgDemo);
    const row = shelf.find((item) => item.code === "MAT-NEW-01");
    expect(row).toMatchObject({
      name: "新开罗纹",
      kind: "trim",
      groupedByCustomer: false,
      usedByStyleCodes: [],
    });
    expect(JSON.stringify(shelf)).not.toContain("Taylorlor");
    expect(row?.composition).toBe("");
    expect(row?.imageSrc).toBe("");
  });

  it("辅料与面料同一架子，货号即编码，可写成分克重幅宽，不是采购", async () => {
    const result = await createMaterialMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "TRIM-BTN-01",
      name: "四眼树脂扣",
      kind: "trim",
      composition: "树脂",
      gsm: "",
      widthCm: "",
      unit: "pcs",
    });
    expect(result.materialCode).toBe("TRIM-BTN-01");
    expect(result.message).toContain("不是已采购");

    const fabric = await createMaterialMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      code: "FAB-NAVY-01",
      name: "海军斜纹",
      kind: "fabric",
      composition: "100%棉",
      gsm: "180",
      widthCm: "150",
    });
    expect(fabric.materialCode).toBe("FAB-NAVY-01");

    const shelf = await listMaterialShelf(IDS.orgDemo);
    const trim = shelf.find((item) => item.code === "TRIM-BTN-01");
    const cloth = shelf.find((item) => item.code === "FAB-NAVY-01");
    expect(trim).toMatchObject({
      kind: "trim",
      kindLabel: "辅料",
      composition: "树脂",
      groupedByCustomer: false,
    });
    expect(cloth).toMatchObject({
      kind: "fabric",
      composition: "100%棉",
      gsm: "180",
      widthCm: "150",
      specSummary: "100%棉 · 180g/m² · 150cm",
    });
    expect(cloth?.createdByName).toBeTruthy();

    const updated = await updateMaterialCard({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      materialId: fabric.materialId,
      composition: "98%棉 2%氨纶",
      gsm: "185",
      widthCm: "148",
    });
    expect(updated.message).toContain("不是库存");
    const after = (await listMaterialShelf(IDS.orgDemo)).find((item) => item.code === "FAB-NAVY-01");
    expect(after?.composition).toBe("98%棉 2%氨纶");
    expect(after?.gsm).toBe("185");
  });

  it("编码重复、工厂、外组织都不能建别人的料", async () => {
    await expect(
      createMaterialMaster({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        code: "MAT-001",
        name: "撞号",
        kind: "fabric",
      }),
    ).rejects.toThrow("货号已存在");

    await expect(
      createMaterialMaster({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        code: "MAT-FAC-01",
        name: "工厂建料",
        kind: "fabric",
      }),
    ).rejects.toThrow("无权");

    const iso = await createMaterialMaster({
      organizationId: IDS.orgIso,
      userId: IDS.userIso,
      role: "salesperson",
      code: "MAT-NEW-01",
      name: "隔离新料",
      kind: "fabric",
    });
    expect(iso.materialCode).toBe("MAT-NEW-01");
    expect(await prisma.material.findFirst({ where: { organizationId: IDS.orgDemo, code: "MAT-NEW-01" } })).toBeNull();
  });
});
