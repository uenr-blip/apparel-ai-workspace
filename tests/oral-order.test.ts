import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createOralOrderDraft, listStyleFillPack } from "@/server/services/oral-order";
import { resetDatabase } from "./helpers";

describe("口头建单", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("业务员可选已有客户和款号建草稿，不复制款式主档，PO 可空", async () => {
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const created = await createOralOrderDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      customerId: IDS.customerNorthshore,
      styleId: IDS.styleSt26018,
      colors: [
        { colorName: "海军蓝", quantity: 80 },
        { colorName: "灰色", quantity: 20 },
      ],
      externalCustomerPo: "  ",
      deliveryText: "10 月口头交期",
      note: "电话确认，邮件未到",
      idempotencyKey: "oral-test-001",
    });

    expect(created.reused).toBe(false);
    expect(created.styleCountAfter).toBe(styleCountBefore);
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: created.orderId },
      include: { lines: { include: { colors: { include: { sizes: true } }, version: true } }, source: true, tasks: true },
    });
    expect(order.customerId).toBe(IDS.customerNorthshore);
    expect(order.externalCustomerPo).toBeNull();
    expect(order.status).toBe("draft");
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.lines[0]?.styleId).toBe(IDS.styleSt26018);
    expect(order.lines[0]?.totalQuantity).toBe(100);
    expect(order.lines[0]?.colors.map((color) => `${color.colorName}:${color.quantity}`)).toEqual(["海军蓝:80", "灰色:20"]);
    expect(order.lines[0]?.colors.every((color) => color.sizes.length === 0)).toBe(true);
    expect(order.lines[0]?.version?.status).toBe("draft");
    expect(order.lines[0]?.styleVersionId).not.toBe(IDS.versionSt26018V1);
    expect(order.source?.origin).toBe("oral-order");
    expect(order.tasks.some((task) => task.kind === "missing_size_breakdown" && task.status === "open")).toBe(true);
    expect(order.notes).toMatch(/口头单/);

    const approved = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(approved.status).toBe("approved");

    const again = await createOralOrderDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      customerId: IDS.customerNorthshore,
      styleId: IDS.styleSt26018,
      colors: [{ colorName: "海军蓝", quantity: 80 }],
      idempotencyKey: "oral-test-001",
    });
    expect(again.reused).toBe(true);
    expect(again.orderId).toBe(created.orderId);
  });

  it("工厂不能建单；跨组织客户或款号拒绝", async () => {
    await expect(
      createOralOrderDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        customerId: IDS.customerNorthshore,
        styleId: IDS.styleSt26018,
        colors: [{ colorName: "海军蓝", quantity: 10 }],
      }),
    ).rejects.toThrow(/无权/);

    await expect(
      createOralOrderDraft({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        customerId: IDS.customerNorthshore,
        styleId: IDS.styleSt26018,
        colors: [{ colorName: "海军蓝", quantity: 10 }],
      }),
    ).rejects.toThrow(/不存在|不属于/);
  });

  it("listStyleFillPack 从该款历史颜色和已批准 BOM 给出可选资料，不发明采购", async () => {
    const pack = await listStyleFillPack(IDS.orgDemo, IDS.styleSt26018);
    expect(pack.colors.map((item) => item.name)).toEqual(expect.arrayContaining(["海军蓝", "灰色"]));
    expect(pack.materials.map((item) => item.code)).toEqual(expect.arrayContaining(["MAT-001"]));
    expect(pack.materials[0]?.kind).toBeTruthy();
    expect(JSON.stringify(pack)).not.toMatch(/issue_purchase|下达采购/);
  });

  it("listStyleFillPack 不串到别的组织", async () => {
    const pack = await listStyleFillPack(IDS.orgIso, IDS.styleSt26018);
    expect(pack.colors).toEqual([]);
    expect(pack.materials).toEqual([]);
  });
});
