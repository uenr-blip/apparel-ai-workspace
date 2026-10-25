import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  assignStyleDesigner,
  createDesigner,
  listDesigners,
  removeDesigner,
} from "@/server/services/designer";
import { createOralOrderDraft } from "@/server/services/oral-order";
import { listOrderSummaries } from "@/server/services/order-board";
import { createStyleMaster } from "@/server/services/style-create";
import { getStyleThread, listStyleSummaries } from "@/server/services/style-thread";
import { resetDatabase } from "./helpers";

describe("设计师署名与会话留痕", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("产品图卡和款式链带出该款设计师，可增可撤，不是登录账号", async () => {
    const roster = await listDesigners(IDS.orgDemo);
    expect(roster.map((item) => item.name)).toEqual(expect.arrayContaining(["沈予安", "顾晚晴"]));

    const cards = await listStyleSummaries(IDS.orgDemo);
    expect(cards.find((row) => row.id === IDS.styleSt26018)?.designerName).toBe("沈予安");

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(thread.identifiers.designer?.name).toBe("沈予安");
    expect(thread.identifiers.createdByName).toBe("林清意");

    await assignStyleDesigner({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      designerId: IDS.designerGu,
    });
    expect((await getStyleThread(IDS.orgDemo, IDS.styleSt26018)).identifiers.designer?.name).toBe("顾晚晴");

    await assignStyleDesigner({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      designerId: null,
    });
    expect((await getStyleThread(IDS.orgDemo, IDS.styleSt26018)).identifiers.designer).toBeNull();

    const created = await createDesigner({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      name: " 叶棠 ",
    });
    expect(created.name).toBe("叶棠");
    await removeDesigner({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      designerId: created.id,
    });
    expect(await prisma.designer.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("挂着款的设计师不能从名单删；工厂和外组织都不能改", async () => {
    await expect(
      removeDesigner({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        designerId: IDS.designerShen,
      }),
    ).rejects.toThrow(/先从款上撤下/);

    await expect(
      createDesigner({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        name: "工厂冒认",
      }),
    ).rejects.toThrow(/无权/);

    await expect(
      assignStyleDesigner({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        designerId: IDS.designerShen,
      }),
    ).rejects.toThrow(/不存在|不属于/);
  });

  it("建单人来自会话，不能自选别人的名字", async () => {
    const created = await createOralOrderDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      customerId: IDS.customerNorthshore,
      styleId: IDS.styleSt26018,
      colors: [{ colorName: "海军蓝", quantity: 10 }],
      idempotencyKey: "actor-oral-001",
    });
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: created.orderId } });
    expect(order.createdByUserId).toBe(IDS.userSales);
    expect(order).not.toHaveProperty("pickedActorName");

    const rows = await listOrderSummaries(IDS.orgDemo, { role: "salesperson", factoryId: null });
    expect(rows.find((row) => row.id === created.orderId)?.createdByName).toBe("林清意");
    expect(rows.find((row) => row.id === IDS.orderHistorical)?.createdByName).toBe("林清意");
  });

  it("新建主档可快选设计师，建档人仍是当前登录用户", async () => {
    const result = await createStyleMaster({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      code: "ST-DES-01",
      name: "设计师快选款",
      designerId: IDS.designerGu,
    });
    const style = await prisma.style.findUniqueOrThrow({ where: { id: result.styleId } });
    expect(style.designerId).toBe(IDS.designerGu);
    expect(style.createdByUserId).toBe(IDS.userManager);
    const card = (await listStyleSummaries(IDS.orgDemo)).find((row) => row.id === result.styleId);
    expect(card?.designerName).toBe("顾晚晴");
    expect(card?.createdByName).toBe("周衡");
  });
});
