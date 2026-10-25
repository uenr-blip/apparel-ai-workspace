import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { classifyOrderWatch } from "@/server/domain/order-watch";
import { assignOrderFactory, listOrderSummaries } from "@/server/services/order-board";
import { getProductionBoard } from "@/server/services/production-board";
import { resetDatabase } from "./helpers";

describe("客户下单与订单进度融进现有板块", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("订单列表带颜色、工厂、PO、资料阻塞，没有裁片库存或开裁完成率", async () => {
    const rows = await listOrderSummaries(IDS.orgDemo, { role: "salesperson", factoryId: null });
    const historical = rows.find((row) => row.orderNo === "DEMO-ORD-001");
    expect(historical).toMatchObject({
      customerName: "北岸服饰",
      styleCodes: "ST-26018",
      colors: "海军蓝、灰色",
      quantity: 800,
      po: "NB-PO-2025-088",
      factoryName: "云杉服装工厂",
    });
    expect(historical?.imageSrc).toBeTruthy();
    expect(typeof historical?.hasPurchaseDraft).toBe("boolean");
    expect(JSON.stringify(rows)).not.toContain("裁片库存");
    expect(JSON.stringify(rows)).not.toContain("开裁完成率");

    const shortage = rows.find((row) => row.orderNo === "DEMO-ORD-002");
    expect(shortage?.watch.fabric).toContain("物料到货待核验");
    const colorHold = rows.find((row) => row.orderNo === "DEMO-ORD-004");
    expect(colorHold?.watch.colorCard.join(" ")).toMatch(/关键批准缺失|颜色确认未通过/);
  });

  it("进度台把面料/色卡写成阻塞列，不是待开裁文件夹", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const shortage = board.rows.find((row) => row.orderNo === "DEMO-ORD-002");
    expect(shortage?.watch.fabric).toContain("物料到货待核验");
    const colorHold = board.rows.find((row) => row.orderNo === "DEMO-ORD-004");
    expect(colorHold?.watch.colorCard.join(" ")).toMatch(/关键批准缺失|颜色确认未通过/);
    expect(JSON.stringify(board)).not.toContain("待开裁");
    expect(JSON.stringify(board)).not.toContain("裁床完成率");
  });

  it("业务员可把草稿派给本组织工厂；工厂不能派；外组织工厂拒绝", async () => {
    const created = await prisma.salesOrder.create({
      data: {
        id: "order-unassigned",
        organizationId: IDS.orgDemo,
        orderNo: "DEMO-ORD-ASSIGN",
        customerId: IDS.customerNorthshore,
        factoryId: null,
        status: "draft",
        productionReadiness: "blocked_incomplete_spec",
        lines: {
          create: { id: "line-assign", styleId: IDS.styleSt26018, totalQuantity: 10 },
        },
      },
    });
    const assigned = await assignOrderFactory({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: created.id,
      factoryId: IDS.factoryYunshan,
    });
    expect(assigned.reused).toBe(false);
    const again = await assignOrderFactory({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId: created.id,
      factoryId: IDS.factoryYunshan,
    });
    expect(again.reused).toBe(true);

    await expect(
      assignOrderFactory({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId: created.id,
        factoryId: "party-wudao",
      }),
    ).rejects.toThrow(/无权/);

    await expect(
      assignOrderFactory({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: created.id,
        factoryId: "party-iso-factory",
      }),
    ).rejects.toThrow(/不存在|不属于/);
  });
});

describe("阻塞分类", () => {
  it("尺码任务进资料，到货核验进面料，缺批准进色卡", () => {
    expect(
      classifyOrderWatch(
        [{ kind: "missing_size_breakdown" }, { kind: "late_material_risk" }, { kind: "missing_approval" }],
        "blocked_incomplete_spec",
      ),
    ).toEqual({
      spec: ["待补尺码"],
      fabric: ["物料到货待核验"],
      colorCard: ["关键批准缺失"],
    });
  });
});
