import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal, ExecutionError } from "@/server/services/execution";
import { linkProjectToStyle } from "@/server/services/reuse";
import { listMaterialShelf } from "@/server/services/material-shelf";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { getStyleThread, listStyleSummaries, StyleThreadError } from "@/server/services/style-thread";
import { linkStyleSeason } from "@/server/services/season";
import { resetDatabase } from "./helpers";

const reorderText = readFileSync("fixtures/01-reorder.txt", "utf8");
const developmentText = readFileSync("fixtures/03-material-development.txt", "utf8");

describe("款式一条链", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("ST-26018 同一主档串起已批准资料和已完成大货，PO 挂在订单上，季节未配置不编造", async () => {
    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    const styleCount = await prisma.style.count({ where: { organizationId: IDS.orgDemo, code: "ST-26018" } });

    expect(styleCount).toBe(1);
    expect(thread.style.code).toBe("ST-26018");
    expect(thread.identifiers.seasons).toEqual([]);
    expect(thread.identifiers.bulkCodeUnverified).toBe(true);
    expect(thread.identifiers.customerBrands).toContain("北岸服饰");
    expect(thread.identifiers.customerPos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderNo: "DEMO-ORD-001", po: "NB-PO-2025-088" }),
      ]),
    );

    expect(thread.stages.map((row) => row.kind)).toEqual(
      expect.arrayContaining(["style_master", "spec_version", "order"]),
    );
    expect(thread.stages.some((row) => row.kind === "development")).toBe(false);

    const master = thread.stages.find((row) => row.kind === "style_master");
    expect(master?.title).toBe("款式主档");
    expect(master?.facts.join(" ")).toContain("翻单不复制");

    const version = thread.stages.find((row) => row.kind === "spec_version");
    expect(version?.title).toContain("第 1 版");
    expect(version?.statusLabel).toBe("已批准");
    expect(version?.facts.join(" ")).toMatch(/面辅料 1 行/);
    expect(version?.facts.join(" ")).toContain("MAT-001");

    const bulk = thread.stages.find((row) => row.kind === "order" && row.role === "bulk");
    expect(bulk?.title).toBe("大货");
    expect(bulk?.href).toBe("/orders/order-demo-001");
    expect(bulk?.facts.join(" ")).toContain("800");
    expect(bulk?.facts.join(" ")).toContain("NB-PO-2025-088");
    expect(bulk?.facts.join(" ")).toContain("毛需求 MAT-001 1236 m");
    expect(bulk?.facts.join(" ")).toContain("未扣库存");
    expect(thread.openBlockers).toEqual([]);
  });

  it("销售样挂在同一主款上，不另建档", async () => {
    const thread = await getStyleThread(IDS.orgDemo, "style-st-26009");
    expect(thread.style.code).toBe("ST-26009");
    const sample = thread.stages.find((row) => row.role === "sales_sample");
    expect(sample?.kind).toBe("order");
    expect(sample?.title).toBe("销售样");
    expect(sample?.facts.join(" ")).toContain("40");
    expect(sample?.facts.join(" ")).toContain("QL-S-01");
    expect(sample?.facts.join(" ")).toContain("同一主款");
    expect(thread.stages.filter((row) => row.kind === "style_master")).toHaveLength(1);
    const spec = thread.stages.find((row) => row.kind === "spec_version");
    expect(spec?.facts.join(" ")).toContain("建档时尚未写入面辅料");
  });

  it("翻单后仍是一条链：新草稿是翻单不是新款，历史 PO 不变，缺资料成为阻塞", async () => {
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: reorderText,
      origin: "style-thread-reorder",
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

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(await prisma.style.count({ where: { organizationId: IDS.orgDemo } })).toBe(styleCountBefore);

    const historical = thread.identifiers.customerPos.find((row) => row.orderNo === "DEMO-ORD-001");
    expect(historical?.po).toBe("NB-PO-2025-088");
    const reorderPo = thread.identifiers.customerPos.find((row) => row.orderNo !== "DEMO-ORD-001");
    expect(reorderPo?.po).toBeNull();

    const reorder = thread.stages.find((row) => row.role === "reorder");
    expect(reorder?.title).toBe("翻单");
    expect(reorder?.href).toBe(`/orders/${approved.result.orderId}`);
    expect(reorder?.statusLabel).toBe("规格不全，不能投产");
    expect(thread.openBlockers.join(" ")).toMatch(/待补尺码|待确认罗纹/);
    expect(reorder?.facts.join(" ")).toContain("待确认交期年份");
    expect(reorder?.facts.join(" ")).toMatch(/交期原文.*年份未确认/);

    const versions = thread.stages.filter((row) => row.kind === "spec_version");
    expect(versions).toHaveLength(2);
    expect(versions[1]?.statusLabel).toBe("草稿");
    expect(versions[1]?.facts.join(" ")).toContain("不得作为正式生产依据");
    expect(versions[0]?.statusLabel).toBe("已批准");
  });

  it("开发款式关联后出现在链头，不复制款号", async () => {
    const ingested = await ingestText({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      text: developmentText,
      origin: "style-thread-dev",
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
    await linkProjectToStyle({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      projectId: approved.result.projectId,
      styleId: IDS.styleSt26018,
    });

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(thread.stages[0]?.kind).toBe("development");
    expect(thread.stages[0]?.href).toBe(`/projects/${approved.result.projectId}`);
    expect(thread.stages[0]?.facts.join(" ")).toMatch(/YARN-DEMO-01|材料/);
    expect(thread.style.code).toBe("ST-26018");
  });

  it("不能读取另一组织的款式链", async () => {
    await expect(getStyleThread(IDS.orgIso, IDS.styleSt26018)).rejects.toBeInstanceOf(StyleThreadError);
    await expect(getStyleThread(IDS.orgIso, IDS.styleSt26018)).rejects.toThrow("当前组织");
  });

  it("图卡把款号、客户品牌、订单PO分开，PO 不是款号", async () => {
    const cards = await listStyleSummaries(IDS.orgDemo);
    const card = cards.find((row) => row.id === IDS.styleSt26018);
    expect(card?.code).toBe("ST-26018");
    expect(card?.customerBrands).toEqual(["北岸服饰"]);
    expect(card?.orderPos).toEqual(
      expect.arrayContaining([expect.objectContaining({ orderNo: "DEMO-ORD-001", po: "NB-PO-2025-088" })]),
    );
    expect(card?.code).not.toBe("NB-PO-2025-088");
    expect(card?.seasonCodes).toEqual([]);

    const sample = cards.find((row) => row.id === "style-st-26009");
    expect(sample?.customerBrands).toEqual(["青岚进出口"]);
    expect(sample?.seasonCodes).toEqual(["SS26"]);
    expect(sample?.orderPos.some((row) => row.po === "QL-S-01")).toBe(true);
  });

  it("色路挂在同一款上，加色不是新款", async () => {
    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(thread.colorways).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          colorName: "海军蓝",
          orderNos: expect.arrayContaining(["DEMO-ORD-001"]),
          latestLabel: "已批准",
          notNewStyle: true,
        }),
        expect.objectContaining({
          colorName: "灰色",
          orderNos: expect.arrayContaining(["DEMO-ORD-001"]),
          latestLabel: "尚未确认",
          notNewStyle: true,
        }),
      ]),
    );
    expect(thread.stages.filter((row) => row.kind === "style_master")).toHaveLength(1);
  });

  it("季节是可配置关系，挂上不复制主档，外组织和工厂不能改", async () => {
    const styleCountBefore = await prisma.style.count({ where: { organizationId: IDS.orgDemo } });
    const first = await linkStyleSeason({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      seasonId: "season-aw26",
    });
    expect(first.reused).toBe(false);
    const again = await linkStyleSeason({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      seasonId: "season-aw26",
    });
    expect(again.reused).toBe(true);
    expect(await prisma.style.count({ where: { organizationId: IDS.orgDemo } })).toBe(styleCountBefore);

    const thread = await getStyleThread(IDS.orgDemo, IDS.styleSt26018);
    expect(thread.identifiers.seasons.map((row) => row.code)).toEqual(["AW26"]);
    expect(thread.style.code).toBe("ST-26018");

    await expect(
      linkStyleSeason({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        styleId: IDS.styleSt26018,
        seasonId: "season-ss26",
      }),
    ).rejects.toThrow("无权");

    await expect(
      linkStyleSeason({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        seasonId: "season-aw26",
      }),
    ).rejects.toThrow("当前组织");
  });
});

describe("面辅料库与建档写面辅料", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("面辅料库按种类列出，标出用在哪款，不按客户分文件夹，隔离第二组织", async () => {
    const shelf = await listMaterialShelf(IDS.orgDemo);
    const mat001 = shelf.find((row) => row.code === "MAT-001");
    expect(mat001).toMatchObject({
      name: "32支精棉汗布",
      kind: "fabric",
      kindLabel: "面料",
      unit: "m",
    });
    expect(mat001?.usedByStyleCodes).toContain("ST-26018");
    expect(shelf.some((row) => row.code === "YARN-DEMO-01" && row.kindLabel === "纱线")).toBe(true);
    expect(shelf.every((row) => row.groupedByCustomer === false)).toBe(true);
    expect(shelf.some((row) => row.code === "MAT-ISO")).toBe(false);

    const iso = await listMaterialShelf(IDS.orgIso);
    expect(iso.map((row) => row.code)).toEqual(["MAT-ISO"]);
    expect(iso[0]?.usedByStyleCodes).toEqual([]);
  });

  it("建档写入面辅料只落在新草稿，不覆盖已批准 V1，用量未确认不能当生产依据", async () => {
    const v1Before = await prisma.bomLine.findMany({ where: { styleVersionId: "version-ST-26009-v1" } });
    expect(v1Before).toHaveLength(0);

    const first = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: "style-st-26009",
      materialIds: [IDS.materialMat001],
    });
    expect(first.createdDraft).toBe(true);
    expect(first.versionNumber).toBe(2);
    expect(first.versionStatus).toBe("draft");
    expect(first.message).toContain("未覆盖已批准版本");

    const v1After = await prisma.styleVersion.findUniqueOrThrow({
      where: { id: "version-ST-26009-v1" },
      include: { bomLines: true },
    });
    expect(v1After.status).toBe("approved");
    expect(v1After.bomLines).toHaveLength(0);

    const v2 = await prisma.styleVersion.findFirstOrThrow({
      where: { styleId: "style-st-26009", versionNumber: 2 },
      include: { bomLines: { include: { material: true } } },
    });
    expect(v2.status).toBe("draft");
    expect(v2.bomLines).toHaveLength(1);
    expect(v2.bomLines[0]?.material.code).toBe("MAT-001");
    expect(v2.bomLines[0]?.confirmed).toBe(false);
    expect(v2.bomLines[0]?.consumption).toBe("pending");

    const thread = await getStyleThread(IDS.orgDemo, "style-st-26009");
    const versions = thread.stages.filter((row) => row.kind === "spec_version");
    expect(versions).toHaveLength(2);
    expect(versions[0]?.facts.join(" ")).toContain("建档时尚未写入面辅料");
    expect(versions[1]?.facts.join(" ")).toMatch(/MAT-001/);
    expect(versions[1]?.facts.join(" ")).toContain("用量待工厂确认");
    expect(versions[1]?.facts.join(" ")).toContain("不得作为正式生产依据");

    const second = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: "style-st-26009",
      materialIds: [IDS.materialMat001],
    });
    expect(second.createdDraft).toBe(false);
    expect(second.versionId).toBe(v2.id);
    expect(
      await prisma.bomLine.count({ where: { styleVersionId: v2.id } }),
    ).toBe(1);
  });

  it("已批准资料上的面辅料不能就地改写，新草稿可带上历史单耗", async () => {
    const result = await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      styleId: IDS.styleSt26018,
      materialIds: [IDS.materialMat001, "material-yarn-01"],
    });
    expect(result.createdDraft).toBe(true);

    const v1 = await prisma.styleVersion.findUniqueOrThrow({
      where: { id: IDS.versionSt26018V1 },
      include: { bomLines: true },
    });
    expect(v1.status).toBe("approved");
    expect(v1.bomLines).toHaveLength(1);
    expect(v1.bomLines[0]?.consumption).toBe("1.5");
    expect(v1.bomLines[0]?.confirmed).toBe(true);

    const draft = await prisma.styleVersion.findFirstOrThrow({
      where: { styleId: IDS.styleSt26018, status: "draft" },
      include: { bomLines: { include: { material: true } } },
      orderBy: { versionNumber: "desc" },
    });
    expect(draft.id).not.toBe(IDS.versionSt26018V1);
    const copied = draft.bomLines.find((line) => line.materialId === IDS.materialMat001);
    const added = draft.bomLines.find((line) => line.materialId === "material-yarn-01");
    expect(copied?.consumption).toBe("1.5");
    expect(copied?.confirmed).toBe(false);
    expect(added?.consumption).toBe("pending");
    expect(added?.confirmed).toBe(false);
  });

  it("工厂无权写面辅料，空选择和外组织都会拒绝", async () => {
    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        styleId: "style-st-26009",
        materialIds: [IDS.materialMat001],
      }),
    ).rejects.toThrow("无权写入面辅料");

    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        styleId: "style-st-26009",
        materialIds: [],
      }),
    ).rejects.toThrow("请至少选择一种面辅料");

    await expect(
      saveStyleBomDraft({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        styleId: IDS.styleSt26018,
        materialIds: [IDS.materialMat001],
      }),
    ).rejects.toBeInstanceOf(ExecutionError);
  });
});
