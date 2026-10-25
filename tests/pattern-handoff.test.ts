import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { getPatternHandoff, handoffPatternSample } from "@/server/services/pattern-handoff";
import { emptyFeedback } from "@/lib/pattern-workflow";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
beforeEach(resetDatabase);
async function setup() {
  await prisma.developmentProject.create({ data: { id: "handoff-project", organizationId: IDS.orgDemo, code: "DEV-HANDOFF", name: "回样交接测试", status: "open", unknownsJson: "[]", styleId: IDS.styleSt26018 } });
  await prisma.patternRevision.create({ data: { id: "handoff-revision", projectId: "handoff-project", number: 1, craftFamily: "sweater", sheetJson: JSON.stringify({ sweater: { yarnComposition: "100%羊毛", yarnCount: "2/48", bodyStructure: "平针" } }), reason: "发厂依据", createdBy: actor.userId, createdByName: "跟单负责人" } });
  await prisma.patternSample.create({ data: { id: "handoff-sample", projectId: "handoff-project", revisionId: "handoff-revision", factoryId: IDS.factoryYunshan, round: 1, quantity: 1, ownerId: actor.userId, createdBy: actor.userId, issuedAt: new Date(), receivedAt: new Date(), feedbackJson: JSON.stringify({ ...emptyFeedback(), returnedOn: "2026-09-26", review: "acceptable", reviewNote: "实物已核对" }) } });
  return input();
}
async function input() { const b = await getPatternHandoff(actor, "handoff-project"); return { projectId: b.projectId, sampleId: b.samples[0].id, projectStamp: b.projectStamp, sampleStamp: b.samples[0].updatedAt, contextStamp: b.contextStamp, processNotes: "袖口尺寸仍按客户最终规格核对", confirmed: true }; }
describe("回样交接到正式资料草稿", () => {
  it("固定来源版次与工厂回样，生成可编辑新草稿，历史和订单不自动改写", async () => {
    const request = await setup();
    const beforeVersions = await prisma.styleVersion.findMany({ where: { styleId: IDS.styleSt26018 } });
    const beforeLines = await prisma.orderLine.findMany({ where: { styleId: IDS.styleSt26018 } });
    const result = await handoffPatternSample(actor, request);
    expect((await handoffPatternSample(actor, request)).versionId).toBe(result.versionId);
    const version = await prisma.styleVersion.findUniqueOrThrow({ where: { id: result.versionId }, include: { bomLines: true } });
    expect(version.status).toBe("draft"); expect(version.specNotes).toContain("100%羊毛"); expect(version.bomLines).toHaveLength(0);
    expect(await prisma.styleVersion.findMany({ where: { id: { in: beforeVersions.map(v => v.id) } } })).toEqual(beforeVersions);
    expect(await prisma.orderLine.findMany({ where: { styleId: IDS.styleSt26018 } })).toEqual(beforeLines);
    expect((await getPatternHandoff(actor, request.projectId)).records[0].snapshot).toMatchObject({ revisionNumber: 1, round: 1, factoryName: "云杉服装工厂" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: version.id, action: "pattern.handoff_created" } });
    expect(audit.actorUserId).toBe(actor.userId); expect(JSON.parse(audit.payloadJson!).after.sampleId).toBe("handoff-sample");
    await expect(handoffPatternSample(actor, { ...request, processNotes: "重复提交偷偷改要求" })).rejects.toThrow(/覆盖原稿/);
  });
  it("未回样、评价不通过、非实际负责人和过期确认均不得交接", async () => {
    const request = await setup();
    await expect(handoffPatternSample({ ...actor, userId: IDS.userManager, role: "manager" }, request)).rejects.toThrow(/实际负责人/);
    await prisma.patternSample.update({ where: { id: request.sampleId }, data: { feedbackJson: JSON.stringify({ ...emptyFeedback(), returnedOn: "2026-09-26", review: "rework" }), updatedAt: new Date(Date.now() + 2000) } });
    await expect(handoffPatternSample(actor, request)).rejects.toThrow(/已变化/);
    await expect(handoffPatternSample(actor, await input())).rejects.toThrow(/可接受/);
    expect(await prisma.patternHandoff.count()).toBe(0);
  });
});
