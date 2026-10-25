import { describe, expect, it, beforeEach } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { approveProposal } from "@/server/services/execution";
import { chooseStyleCandidate, getReview, ingestText, parseSource } from "@/server/services/intake";
import { resetDatabase } from "./helpers";

const ORAL = "还是上次那款，增加一批，颜色按新图，尺码明天补。";

describe("收件箱可处理任务卡", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("口头翻单先出三件任务，不自动建单；选定资料后才落草稿", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: ORAL,
      origin: "inbox-oral-task",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });

    expect(parsed.extraction.intent).toBe("reorder");
    expect(parsed.extraction.styleCode.value).toBeNull();
    expect(parsed.proposal).toBeNull();
    expect(parsed.candidates.length).toBeGreaterThanOrEqual(2);
    expect(parsed.candidates.every((item) => item.selected === false)).toBe(true);
    expect(parsed.candidates.map((item) => item.code)).toEqual(expect.arrayContaining(["ST-26018", "ST-26001"]));
    expect(parsed.candidates[0].reason).toContain("资料匹配");
    expect(parsed.candidates[0].reason).toContain("不是视觉识款");
    expect(parsed.tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/已找到 \d+ 份可能相关的历史资料，需要你选择/),
        "新颜色尚未确认，不能沿用旧样品批准。",
        "尺码未齐，暂不形成完整数量明细。",
      ]),
    );
    expect(parsed.tasks.every((task) => task.status === "open")).toBe(true);

    const chosen = await chooseStyleCandidate({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sourceId: ingested.source.id,
      styleId: IDS.styleSt26018,
    });
    expect(chosen.proposal?.actionType).toBe("create_order_draft");
    expect(chosen.tasks.find((task) => task.id === "choose_history")?.status).toBe("done");
    expect(chosen.tasks.find((task) => task.id === "choose_history")?.title).toContain("ST-26018");
    expect(chosen.tasks.find((task) => task.id === "choose_history")?.title).toContain("必须重确认");

    const review = await getReview(IDS.orgDemo, ingested.source.id);
    expect(review.tasks.find((task) => task.id === "choose_history")?.status).toBe("done");
    expect(review.proposal?.id).toBe(chosen.proposal?.id);

    const approved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: chosen.proposal!.id,
    });
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: approved.result.orderId },
      include: { tasks: true, lines: { include: { colors: true } } },
    });
    expect(order.status).toBe("draft");
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.tasks.some((task) => task.kind === "missing_size_breakdown" && task.status === "open")).toBe(true);
    expect(order.tasks.some((task) => task.kind === "missing_approval" && task.status === "open")).toBe(true);
    expect(order.tasks.some((task) => task.kind === "missing_rib_spec")).toBe(false);
    expect(order.lines[0]?.colors).toEqual([]);
    expect(await assertCannotRelease(order.id)).toBe(true);
  });

  it("工厂不能选定历史资料", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: `${ORAL} ${Date.now()}`,
      origin: "inbox-oral-factory",
    });
    await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    await expect(
      chooseStyleCandidate({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        sourceId: ingested.source.id,
        styleId: IDS.styleSt26018,
      }),
    ).rejects.toThrow("无权选定历史资料");
  });
});

async function assertCannotRelease(orderId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  return order.productionReadiness !== "ready_for_production";
}
