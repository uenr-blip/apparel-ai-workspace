import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { submitColorConfirmation } from "@/server/services/color-confirm";
import { approveProposal } from "@/server/services/execution";
import { chooseStyleCandidate, getReview, ingestText, parseSource } from "@/server/services/intake";
import { saveOrderPrep } from "@/server/services/order-prep";
import { getWorkspaceSnapshot } from "@/server/services/workspace";
import { resetDatabase } from "./helpers";

const ORAL = "还是上次那款，增加一批，颜色按新图，尺码明天补。";

async function createOralDraft() {
  const ingested = await ingestText({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    text: `${ORAL} ${Date.now()}`,
    origin: "inbox-oral-followup",
  });
  await parseSource({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    sourceId: ingested.source.id,
  });
  const chosen = await chooseStyleCandidate({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    sourceId: ingested.source.id,
    styleId: IDS.styleSt26018,
  });
  const approved = await approveProposal({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    role: "salesperson",
    proposalId: chosen.proposal!.id,
  });
  return { sourceId: ingested.source.id, orderId: approved.result.orderId as string };
}

describe("收件箱任务接到订单缺项", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("草稿落地后颜色/尺码任务可点进对应区块；处理完变已处理，仍不能投产", async () => {
    const { sourceId, orderId } = await createOralDraft();
    const review = await getReview(IDS.orgDemo, sourceId);
    const colorTask = review.tasks.find((task) => task.id === "color_unconfirmed");
    const sizeTask = review.tasks.find((task) => task.id === "size_incomplete");
    expect(colorTask?.status).toBe("open");
    expect(sizeTask?.status).toBe("open");
    expect(colorTask?.href).toBe(`/orders/${orderId}#color-confirm`);
    expect(sizeTask?.href).toBe(`/orders/${orderId}#size-matrix`);

    const workspace = await getWorkspaceSnapshot(IDS.orgDemo);
    expect(workspace.blockGroups.some((row) => row.href.includes(orderId) || row.key === orderId)).toBe(false);

    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      newColors: [{ colorName: "新图色", quantity: 10 }],
      sizes: [{ colorName: "新图色", breakdown: { M: 10 } }],
      expectedUpdatedAt: order.updatedAt.toISOString(),
    });

    const afterSize = await getReview(IDS.orgDemo, sourceId);
    expect(afterSize.tasks.find((task) => task.id === "size_incomplete")?.status).toBe("done");
    expect(afterSize.tasks.find((task) => task.id === "color_unconfirmed")?.status).toBe("open");

    const refreshed = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    await submitColorConfirmation({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      materialId: IDS.materialMat001,
      colorName: "新图色",
      status: "approved",
      evidence: "按新图核对色样，不沿用旧批准",
    });
    expect(refreshed.productionReadiness).not.toBe("ready_for_production");

    const afterColor = await getReview(IDS.orgDemo, sourceId);
    expect(afterColor.tasks.find((task) => task.id === "color_unconfirmed")?.status).toBe("done");
    expect(afterColor.tasks.find((task) => task.id === "size_incomplete")?.status).toBe("done");
    const stillBlocked = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(stillBlocked.productionReadiness).not.toBe("ready_for_production");
  });
});
