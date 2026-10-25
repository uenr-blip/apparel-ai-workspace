import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { referenceApprovedMaterials } from "@/server/services/order-prep";
import { resetDatabase } from "./helpers";

async function pointShortageAtEmptyDraft() {
  const line = await prisma.orderLine.findFirstOrThrow({
    where: { orderId: IDS.orderShortage },
    include: { version: { include: { bomLines: true } } },
  });
  const approved = await prisma.styleVersion.findFirstOrThrow({
    where: { styleId: line.styleId, status: "approved" },
    include: { bomLines: true },
  });
  const draft = await prisma.styleVersion.create({
    data: {
      id: createId(),
      styleId: line.styleId,
      versionNumber: approved.versionNumber + 1,
      status: "draft",
      cuffType: approved.cuffType,
      changeSummary: "空草稿",
    },
  });
  return { lineId: line.id, draftId: draft.id, approvedId: approved.id, approvedCount: approved.bomLines.length };
}

describe("引用已批准面辅料到本单草稿", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("只写入空草稿，已批准版本和采购草稿不动", async () => {
    const { lineId, draftId, approvedId, approvedCount } = await pointShortageAtEmptyDraft();
    expect(approvedCount).toBeGreaterThan(0);
    const draftsBefore = await prisma.purchaseDraft.count({ where: { orderId: IDS.orderShortage } });

    await expect(
      referenceApprovedMaterials({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: IDS.orderShortage,
      }),
    ).rejects.toThrow("已批准版本不能就地写入面辅料");

    await prisma.orderLine.update({
      where: { id: lineId },
      data: { styleVersionId: draftId },
    });

    const result = await referenceApprovedMaterials({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: IDS.orderShortage,
    });
    expect(result.copied).toBe(approvedCount);
    expect(result.sourceVersionId).toBe(approvedId);

    const copied = await prisma.bomLine.findMany({ where: { styleVersionId: draftId } });
    const approved = await prisma.bomLine.findMany({ where: { styleVersionId: approvedId } });
    expect(copied).toHaveLength(approvedCount);
    expect(approved).toHaveLength(approvedCount);
    expect(copied.every((row) => row.confirmed === true)).toBe(true);
    expect(copied.map((row) => row.materialId).sort()).toEqual(approved.map((row) => row.materialId).sort());
    expect(copied.every((row) => !approved.some((item) => item.id === row.id))).toBe(true);

    const approvedVersion = await prisma.styleVersion.findUniqueOrThrow({ where: { id: approvedId } });
    const draftVersion = await prisma.styleVersion.findUniqueOrThrow({ where: { id: draftId } });
    expect(approvedVersion.status).toBe("approved");
    expect(approvedVersion.changeSummary).toBe("已批准技术资料 V1");
    expect(draftVersion.status).toBe("draft");
    expect(draftVersion.changeSummary).toContain("未覆盖已批准版本");
    expect(await prisma.purchaseDraft.count({ where: { orderId: IDS.orderShortage } })).toBe(draftsBefore);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "order.reference_approved_bom", entityId: draftId },
    });
    expect(audit?.summary).toContain("未覆盖已批准版本");

    await expect(
      referenceApprovedMaterials({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        orderId: IDS.orderShortage,
      }),
    ).rejects.toThrow("本单草稿已有面辅料");
    await expect(
      referenceApprovedMaterials({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId: IDS.orderShortage,
      }),
    ).rejects.toThrow("无权");
    await expect(
      referenceApprovedMaterials({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        orderId: IDS.orderShortage,
      }),
    ).rejects.toThrow("不属于当前组织");
  });
});
