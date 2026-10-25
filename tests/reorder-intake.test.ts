import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal, assertCannotReleaseToProduction } from "@/server/services/execution";
import { resetDatabase } from "./helpers";

const reorderText = readFileSync("fixtures/01-reorder.txt", "utf8");

describe("S1 翻单资料闭环", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("关联旧款、PO 为空、批准后持久化且幂等，不能投产", async () => {
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const orderCountBefore = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });
    const historical = await prisma.salesOrder.findUniqueOrThrow({ where: { id: IDS.orderHistorical } });
    const v1 = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    const v1Bom = await prisma.bomLine.findMany({ where: { styleVersionId: v1.id } });

    const first = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "fixtures/01-reorder.txt",
    });
    const duplicate = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "fixtures/01-reorder.txt",
    });
    expect(duplicate.alreadyExisted).toBe(true);
    expect(duplicate.source.id).toBe(first.source.id);

    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: first.source.id,
    });

    expect(parsed.mode).toBe("mock");
    expect(parsed.calledLiveModel).toBe(false);
    expect(parsed.extraction.styleCode.value).toBe("ST-26018");
    expect(parsed.extraction.externalCustomerPo.value).toBeNull();
    expect(parsed.extraction.colors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ colorName: "海军蓝", quantity: 600 }),
        expect.objectContaining({ colorName: "灰色", quantity: 400 }),
      ]),
    );
    expect(parsed.extraction.totalQuantity.value).toBe(1000);
    expect(parsed.extraction.deliveryText.kind).toBe("extracted");
    expect(parsed.extraction.deliveryDateInferred.kind).toBe("inferred");
    expect(String(parsed.extraction.deliveryDateInferred.inferenceNote)).toContain("不是原文已写明的事实");
    expect(parsed.extraction.unknowns).toEqual(
      expect.arrayContaining(["尺码明细", "罗纹规格与批准", "交期年份推断"]),
    );
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].code).toBe("ST-26018");
    expect(parsed.proposal).toBeTruthy();

    const approved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });
    const again = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });

    expect(again.reused).toBe(true);
    expect(again.result.orderId).toBe(approved.result.orderId);

    const styleCountAfter = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const orderCountAfter = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });
    expect(styleCountAfter).toBe(styleCountBefore);
    expect(orderCountAfter).toBe(orderCountBefore + 1);

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: approved.result.orderId },
      include: { lines: { include: { colors: { include: { sizes: true } } } }, tasks: true, source: true },
    });
    expect(order.externalCustomerPo).toBeNull();
    expect(order.externalCustomerPo).not.toBe(historical.externalCustomerPo);
    expect(order.status).toBe("draft");
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.sourceDocumentId).toBe(first.source.id);
    expect(order.lines[0]?.styleId).toBe(IDS.styleSt26018);
    expect(order.lines[0]?.colors.map((row) => row.quantity).sort()).toEqual([400, 600]);
    expect(order.lines[0]?.colors.some((row) => row.sizes.length > 0)).toBe(false);
    expect(order.requestedDeliveryDate).toBeNull();
    expect(order.tasks.map((task) => task.kind).sort()).toEqual([
      "missing_delivery_year",
      "missing_rib_spec",
      "missing_size_breakdown",
    ]);

    const historicalAfter = await prisma.salesOrder.findUniqueOrThrow({ where: { id: IDS.orderHistorical } });
    expect(historicalAfter.externalCustomerPo).toBe("NB-PO-2025-088");
    expect(historicalAfter.status).toBe("completed");

    const v1After = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(v1After.status).toBe("approved");
    expect(v1After.cuffType).toBe("包边袖口");
    const v1BomAfter = await prisma.bomLine.findMany({ where: { styleVersionId: v1.id } });
    expect(v1BomAfter).toHaveLength(v1Bom.length);

    const v2 = await prisma.styleVersion.findFirst({
      where: { styleId: IDS.styleSt26018, versionNumber: 2 },
    });
    expect(v2?.status).toBe("draft");
    expect(v2?.cuffType).toBe("罗纹");

    await expect(assertCannotReleaseToProduction(order.id)).rejects.toThrow("不能批准投产");
  });

  it("英文翻单邮件走同一闭环：对照演示客户、PO 为空、不新建主款、不能投产", async () => {
    const emailText = readFileSync("fixtures/06-reorder-email-en.txt", "utf8");
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const orderCountBefore = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });

    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: emailText,
      origin: "fixtures/06-reorder-email-en.txt",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });

    expect(parsed.mode).toBe("mock");
    expect(parsed.calledLiveModel).toBe(false);
    expect(parsed.extraction.intent).toBe("reorder");
    expect(parsed.extraction.customerName.value).toBe("北岸服饰");
    expect(parsed.extraction.customerName.sourceText).toMatch(/Northshore Apparel/i);
    expect(parsed.extraction.styleCode.value).toBe("ST-26018");
    expect(parsed.extraction.externalCustomerPo.value).toBeNull();
    expect(parsed.extraction.colors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ colorName: "海军蓝", quantity: 600, sourceText: expect.stringMatching(/Navy 600 pcs/i) }),
        expect.objectContaining({ colorName: "灰色", quantity: 400, sourceText: expect.stringMatching(/Grey 400 pcs/i) }),
      ]),
    );
    expect(parsed.extraction.totalQuantity.value).toBe(1000);
    expect(parsed.extraction.deliveryText.value).toMatch(/20 October/i);
    expect(parsed.extraction.deliveryDateInferred.kind).toBe("inferred");
    expect(parsed.extraction.modifications).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "cuffType", requested: "罗纹" })]),
    );
    expect(parsed.extraction.unknowns).toEqual(
      expect.arrayContaining(["尺码明细", "罗纹规格与批准", "交期年份推断", "客户PO"]),
    );
    expect(parsed.extraction.notes).toEqual(
      expect.arrayContaining(["英文客户名已对照演示客户北岸服饰，未新建客户"]),
    );
    expect(parsed.candidates[0]?.code).toBe("ST-26018");

    const approved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });

    const styleCountAfter = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const orderCountAfter = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });
    expect(styleCountAfter).toBe(styleCountBefore);
    expect(orderCountAfter).toBe(orderCountBefore + 1);

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: approved.result.orderId },
      include: { customer: true, lines: { include: { colors: true } } },
    });
    expect(order.customer.name).toBe("北岸服饰");
    expect(order.externalCustomerPo).toBeNull();
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.lines[0]?.colors.map((row) => row.quantity).sort()).toEqual([400, 600]);
    await expect(assertCannotReleaseToProduction(order.id)).rejects.toThrow("不能批准投产");
  });

  it("同一款第二次翻单新建下一资料草稿，不覆盖已有草稿版本", async () => {
    const first = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "second-reorder-a",
    });
    const firstParsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: first.source.id,
    });
    const firstApproved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: firstParsed.proposal!.id,
    });

    const second = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: `${reorderText} 批次二次翻单`,
      origin: "second-reorder-b",
    });
    const secondParsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: second.source.id,
    });
    const secondApproved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: secondParsed.proposal!.id,
    });

    expect(secondApproved.result.orderId).not.toBe(firstApproved.result.orderId);
    const versions = await prisma.styleVersion.findMany({
      where: { styleId: IDS.styleSt26018 },
      orderBy: { versionNumber: "asc" },
    });
    expect(versions.map((row) => [row.versionNumber, row.status])).toEqual([
      [1, "approved"],
      [2, "draft"],
      [3, "draft"],
    ]);
    expect(versions[0]?.cuffType).toBe("包边袖口");
  });

  it("工厂角色不能批准创建订单草稿", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "role-check",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    await expect(
      approveProposal({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        proposalId: parsed.proposal!.id,
      }),
    ).rejects.toThrow("无权");
  });

  it("不能读取或执行另一组织的来源", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "iso-check",
    });
    await expect(
      parseSource({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        sourceId: ingested.source.id,
      }),
    ).rejects.toThrow("当前组织");
  });
});
