import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal } from "@/server/services/execution";
import { adoptReuseCandidate, linkProjectToStyle, rejectReuseCandidate, searchKnowledge } from "@/server/services/reuse";
import { resetDatabase } from "./helpers";

const developmentText = readFileSync("fixtures/03-material-development.txt", "utf8");

describe("S2 材料先行开发", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("批准后创建开发款式并引用两种纱线，不新建款号也不复制材料", async () => {
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const materialCountBefore = await prisma.material.count({ where: { organizationId: IDS.orgDemo } });

    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: developmentText,
      origin: "fixtures/03-material-development.txt",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });

    expect(parsed.extraction.intent).toBe("material_dev");
    expect(parsed.extraction.styleCode.value).toBeNull();
    expect(parsed.extraction.materials.map((row) => row.code).sort()).toEqual(["YARN-DEMO-01", "YARN-DEMO-02"]);
    expect(parsed.extraction.unknowns).toEqual(
      expect.arrayContaining(["试验报告", "成分要求", "目标成本", "投产数量", "款号"]),
    );
    expect(parsed.proposal?.actionType).toBe("create_development_project");

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
    expect(again.result.projectId).toBe(approved.result.projectId);

    const project = await prisma.developmentProject.findUniqueOrThrow({
      where: { id: approved.result.projectId },
      include: { candidates: true },
    });
    expect(project.styleId).toBeNull();
    expect(project.customerId).toBe(IDS.customerNorthshore);
    expect(project.candidates.filter((row) => row.kind === "material")).toHaveLength(2);
    expect(project.candidates.every((row) => row.copyMode === "reference")).toBe(true);
    expect(JSON.stringify(project)).not.toMatch(/已批准可直接使用/);

    expect(await prisma.style.count({ where: { organizationId: IDS.orgDemo } })).toBe(styleCountBefore);
    expect(await prisma.material.count({ where: { organizationId: IDS.orgDemo } })).toBe(materialCountBefore);
  });

  it("后续关联款式不复制开发材料主档", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: developmentText,
      origin: "link-style",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    const approved = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });
    const materialCount = await prisma.material.count({ where: { organizationId: IDS.orgDemo } });
    const linked = await linkProjectToStyle({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      projectId: approved.result.projectId,
      styleId: IDS.styleSt26018,
    });
    expect(linked.styleId).toBe(IDS.styleSt26018);
    const project = await prisma.developmentProject.findUniqueOrThrow({
      where: { id: approved.result.projectId },
      include: { candidates: true },
    });
    expect(project.styleId).toBe(IDS.styleSt26018);
    expect(project.candidates).toHaveLength(2);
    expect(await prisma.material.count({ where: { organizationId: IDS.orgDemo } })).toBe(materialCount);
  });
});

describe("S2 历史复用检索", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("圆领针织检索返回资料匹配候选，并优先展示可用材料", async () => {
    const result = await searchKnowledge({
      organizationId: IDS.orgDemo,
      query: "找类似的圆领针织款，优先查看已有可用材料",
    });
    expect(result.matchMethod).toBe("keyword");
    expect(result.matchLabel).toBe("资料匹配");
    expect(JSON.stringify(result)).not.toMatch(/视觉相似|AI 视觉识款|98%/);
    expect(result.styles.some((row) => row.code === "ST-26018")).toBe(true);
    expect(result.styles.every((row) => row.matchReasons.length > 0)).toBe(true);
    expect(result.materials.some((row) => row.code === "MAT-001" && Number(row.freeQty) > 0)).toBe(true);
    expect(result.styles.every((row) => row.historicalApprovalReusable === false)).toBe(true);
  });

  it("采用候选只建引用并记录必须重确认项，拒绝时保留原因", async () => {
    const search = await searchKnowledge({
      organizationId: IDS.orgDemo,
      query: "圆领针织",
    });
    const styleHit = search.styles.find((row) => row.code === "ST-26018");
    expect(styleHit).toBeTruthy();

    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: developmentText,
      origin: "reuse-adopt",
    });
    const parsed = await parseSource({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      sourceId: ingested.source.id,
    });
    const project = await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });

    const adopted = await adoptReuseCandidate({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      projectId: project.result.projectId,
      candidateKind: "style",
      candidateId: styleHit!.id,
      query: "圆领针织",
    });
    expect(adopted.copyMode).toBe("reference");
    expect(adopted.mustReconfirm).toEqual(
      expect.arrayContaining(["历史客户批准不可沿用", "历史报价不是本项目成本", "手感与缩水待测"]),
    );

    const event = await prisma.knowledgeReuseEvent.findFirst({
      where: { organizationId: IDS.orgDemo, status: "adopted", candidateId: styleHit!.id },
    });
    expect(event?.matchMethod).toBe("keyword");

    const rejected = await rejectReuseCandidate({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      candidateKind: "material",
      candidateId: "material-yarn-02",
      query: "圆领针织",
      reason: "缩水风险未测，先不做样",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectReason).toBe("缩水风险未测，先不做样");
  });

  it("跨组织检索不能看到演示组织款式", async () => {
    const result = await searchKnowledge({
      organizationId: IDS.orgIso,
      query: "圆领针织 ST-26018",
    });
    expect(result.styles.some((row) => row.code === "ST-26018")).toBe(false);
  });
});
