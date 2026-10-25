import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getDecisionRecord, listDecisions } from "@/server/services/decision-center";
import { approveProposal, rejectProposal } from "@/server/services/execution";
import { ingestText, parseSource } from "@/server/services/intake";
import { resetDatabase } from "./helpers";

const reorderText = readFileSync("fixtures/01-reorder.txt", "utf8");

async function previewReorder() {
  const first = await ingestText({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    text: reorderText,
    origin: "fixtures/01-reorder.txt",
  });
  const parsed = await parseSource({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    sourceId: first.source.id,
  });
  return { sourceId: first.source.id, proposalId: parsed.proposal!.id };
}

describe("决策中心提案详情", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("详情带出依据、风险、跳转，拒绝后不能再批准", async () => {
    const { sourceId, proposalId } = await previewReorder();
    const record = await getDecisionRecord(IDS.orgDemo, proposalId);
    expect(record.status).toBe("preview");
    expect(record.evidenceLines.join(" ")).toContain("ST-26018");
    expect(record.risks.length).toBeGreaterThan(0);
    expect(record.links.inbox).toBe(`/inbox/${sourceId}`);
    expect(record.links.style).toBe(`/styles/${IDS.styleSt26018}`);
    expect(record.links.order).toBeNull();
    expect(record.willNotChange.join(" ")).toContain("款式主档");

    const listed = await listDecisions(IDS.orgDemo, { status: "preview" });
    const row = listed.find((item) => item.id === proposalId);
    expect(row?.detail).toContain("ST-26018");
    expect(row?.excerpt).toContain("北岸服饰");
    expect(row?.when).toMatch(/\d+月\d+日/);
    expect(row?.sourceMark).toHaveLength(6);
    const byExcerpt = await listDecisions(IDS.orgDemo, { status: "preview", q: "北岸服饰" });
    expect(byExcerpt.map((item) => item.id)).toContain(proposalId);

    await rejectProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId,
    });
    expect((await getDecisionRecord(IDS.orgDemo, proposalId)).status).toBe("rejected");
    await expect(
      approveProposal({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        proposalId,
      }),
    ).rejects.toThrow("已拒绝");

    await expect(
      rejectProposal({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        proposalId,
      }),
    ).rejects.toThrow("无权");
    await expect(getDecisionRecord(IDS.orgIso, proposalId)).rejects.toThrow("不存在");
  });

  it("已批准资料版本变了，旧提案过期，不能按旧预览执行", async () => {
    const { proposalId } = await previewReorder();
    const current = await prisma.styleVersion.findFirstOrThrow({
      where: { styleId: IDS.styleSt26018, status: "approved" },
      orderBy: { versionNumber: "desc" },
    });
    await prisma.styleVersion.create({
      data: {
        id: "version-st-26018-v9",
        styleId: IDS.styleSt26018,
        versionNumber: current.versionNumber + 1,
        status: "approved",
        cuffType: "罗纹",
        changeSummary: "测试依据变更",
      },
    });

    const record = await getDecisionRecord(IDS.orgDemo, proposalId);
    expect(record.status).toBe("expired");
    expect(record.staleReason).toContain("资料版本已变");
    await expect(
      approveProposal({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        proposalId,
      }),
    ).rejects.toThrow("过期");
  });
});
