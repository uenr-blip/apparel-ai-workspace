import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ExecutionError } from "@/server/services/execution";
import { getColorConfirmationBoard, submitColorConfirmation } from "@/server/services/color-confirm";
import { getStyleThread } from "@/server/services/style-thread";
import { resetDatabase } from "./helpers";

const ORDER_ID = IDS.orderColorHold;

describe("分色确认轮次", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("同一单同一材料两色分开记：海军蓝已批准、灰色退回，不得显示整款已批准", async () => {
    const board = await getColorConfirmationBoard(IDS.orgDemo, ORDER_ID);
    expect(board.orderNo).toBe("DEMO-ORD-004");
    expect(board.allColorsLatestApproved).toBe(false);
    expect(board.headline).toContain("海军蓝");
    expect(board.headline).toContain("灰色");
    expect(board.headline).not.toContain("整款已批准");
    expect(board.imageJudgement).toBe(false);

    const navy = board.colors.find((row) => row.colorName === "海军蓝");
    const grey = board.colors.find((row) => row.colorName === "灰色");
    expect(navy?.latest?.status).toBe("approved");
    expect(navy?.latest?.round).toBe(1);
    expect(grey?.latest?.status).toBe("rejected");
    expect(grey?.latest?.evidence).toBe("手感不符退回");
    expect(grey?.latest?.materialCode).toBe("MAT-001");

    const thread = await getStyleThread(IDS.orgDemo, "style-st-26003");
    const order = thread.stages.find((row) => row.id === ORDER_ID);
    expect(order?.facts.join(" ")).toContain("灰色第 1 轮退回");
    expect(order?.facts.join(" ")).toContain("海军蓝已批准");
    expect(order?.facts.join(" ")).not.toContain("整款已批准");
    expect(order?.statusLabel).toBe("颜色确认未通过");
  });

  it("灰色第二轮批准不覆盖第一轮退回记录，全部最新一轮通过后仍不能投产", async () => {
    const first = await prisma.confirmationRecord.findMany({
      where: { orderId: ORDER_ID, colorName: "灰色" },
    });
    expect(first).toHaveLength(1);

    const result = await submitColorConfirmation({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: ORDER_ID,
      materialId: IDS.materialMat001,
      colorName: "灰色",
      status: "approved",
      evidence: "第二轮色样通过，手感已改",
    });
    expect(result.round).toBe(2);
    expect(result.allColorsLatestApproved).toBe(true);
    expect(result.headline).not.toContain("整款已批准");
    expect(result.message).toContain("分色");
    expect(result.message).toContain("不能投产");

    const grey = await prisma.confirmationRecord.findMany({
      where: { orderId: ORDER_ID, colorName: "灰色" },
      orderBy: { round: "asc" },
    });
    expect(grey).toHaveLength(2);
    expect(grey[0]).toMatchObject({ round: 1, status: "rejected", evidence: "手感不符退回" });
    expect(grey[1]).toMatchObject({ round: 2, status: "approved", evidence: "第二轮色样通过，手感已改" });

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: ORDER_ID },
      include: { tasks: true },
    });
    expect(order.productionReadiness).toBe("color_approved");
    expect(order.tasks.find((task) => task.kind === "missing_approval")?.status).toBe("done");

    const board = await getColorConfirmationBoard(IDS.orgDemo, ORDER_ID);
    expect(board.colors.find((row) => row.colorName === "灰色")?.history).toHaveLength(2);
    expect(board.allColorsLatestApproved).toBe(true);
  });

  it("工厂无权记录；缺证据/错颜色拒绝；外组织读不到", async () => {
    await expect(
      submitColorConfirmation({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId: ORDER_ID,
        materialId: IDS.materialMat001,
        colorName: "灰色",
        status: "approved",
        evidence: "工厂口头说可以",
      }),
    ).rejects.toThrow("无权记录颜色确认");

    await expect(
      submitColorConfirmation({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: ORDER_ID,
        materialId: IDS.materialMat001,
        colorName: "灰色",
        status: "rejected",
        evidence: "   ",
      }),
    ).rejects.toThrow("请填写确认依据");

    await expect(
      submitColorConfirmation({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId: ORDER_ID,
        materialId: IDS.materialMat001,
        colorName: "本色",
        status: "approved",
        evidence: "不存在的颜色",
      }),
    ).rejects.toThrow("颜色不在当前订单");

    await expect(getColorConfirmationBoard(IDS.orgIso, ORDER_ID)).rejects.toBeInstanceOf(ExecutionError);
  });
});
