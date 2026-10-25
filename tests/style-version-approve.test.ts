import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal, assertCannotReleaseToProduction, releaseToProduction } from "@/server/services/execution";
import { saveOrderPrep } from "@/server/services/order-prep";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { approveOrderSpec } from "@/server/services/style-version";
import { resetDatabase } from "./helpers";

const reorderText = readFileSync("fixtures/01-reorder.txt", "utf8");
const validSizes = [
  { colorName: "海军蓝", breakdown: { XS: 60, S: 120, M: 240, L: 120, XL: 60 } },
  { colorName: "灰色", breakdown: { XS: 40, S: 80, M: 160, L: 80, XL: 40 } },
];

async function createReorderDraft() {
  const ingested = await ingestText({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    text: `${reorderText} 规格批准 ${createId()}`,
    origin: "spec-approve",
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
  return approved.result.orderId as string;
}

async function stamp(orderId: string) {
  const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
  return order.updatedAt.toISOString();
}

describe("资料版本批准", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("经理批准本单草稿后罗纹任务关闭，历史 V1 不变，仍不能真正投产", async () => {
    const orderId = await createReorderDraft();
    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹，克重与缩水待测",
      expectedUpdatedAt: await stamp(orderId),
    });
    const v1Before = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });

    const result = await approveOrderSpec({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId,
      expectedUpdatedAt: await stamp(orderId),
    });

    expect(result.reused).toBe(false);
    expect(result.versionStatus).toBe("approved");
    expect(result.ribTaskStatus).toBe("done");
    expect(result.productionReadiness).toBe("spec_approved");
    expect(result.message).toContain("资料版本已批准");
    expect(result.message).toContain("投产");

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: { version: true } }, tasks: true },
    });
    expect(order.lines[0]?.version?.status).toBe("approved");
    expect(order.lines[0]?.version?.id).not.toBe(IDS.versionSt26018V1);
    expect(order.tasks.find((task) => task.kind === "missing_rib_spec")?.status).toBe("done");

    const v1After = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(v1After.status).toBe("approved");
    expect(v1After.cuffType).toBe(v1Before.cuffType);
    expect(v1After.specNotes).toBe(v1Before.specNotes);

    const duplicate = await approveOrderSpec({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId,
      expectedUpdatedAt: result.updatedAt,
    });
    expect(duplicate.reused).toBe(true);
    const audits = await prisma.auditEvent.count({
      where: { entityId: orderId, action: "style_version.approved" },
    });
    expect(audits).toBe(1);

    await expect(assertCannotReleaseToProduction(orderId)).rejects.toThrow("不能批准投产");
    await expect(
      releaseToProduction({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        orderId,
      }),
    ).rejects.toThrow("不能批准投产");
  });

  it("规格未记录时不能批准；色尺未齐时批准后仍不能当成可投产", async () => {
    const orderId = await createReorderDraft();
    await expect(
      approveOrderSpec({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        orderId,
        expectedUpdatedAt: await stamp(orderId),
      }),
    ).rejects.toThrow("罗纹规格");

    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: [{ colorName: "海军蓝", breakdown: { M: 10 } }],
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: await stamp(orderId),
    });

    const result = await approveOrderSpec({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId,
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(result.ribTaskStatus).toBe("done");
    expect(result.productionReadiness).toBe("blocked_incomplete_spec");
    expect(result.message).toContain("色尺尚未对齐");
  });

  it("业务员和工厂不能批准资料版本", async () => {
    const orderId = await createReorderDraft();
    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: await stamp(orderId),
    });
    await expect(
      approveOrderSpec({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId,
        expectedUpdatedAt: await stamp(orderId),
      }),
    ).rejects.toThrow("无权");
    await expect(
      approveOrderSpec({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId,
        expectedUpdatedAt: await stamp(orderId),
      }),
    ).rejects.toThrow("无权");
  });

  it("批准资料不会把 pending 单耗标成已确认", async () => {
    const orderId = await createReorderDraft();
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true },
    });
    await saveStyleBomDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      styleId: IDS.styleSt26018,
      materialIds: [IDS.materialMat001, "material-yarn-01"],
    });
    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: await stamp(orderId),
    });
    await approveOrderSpec({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId,
      expectedUpdatedAt: await stamp(orderId),
    });
    const versionId = order.lines[0]!.styleVersionId!;
    const lines = await prisma.bomLine.findMany({ where: { styleVersionId: versionId } });
    expect(lines.find((row) => row.materialId === IDS.materialMat001)?.confirmed).toBe(true);
    expect(lines.find((row) => row.materialId === "material-yarn-01")?.consumption).toBe("pending");
    expect(lines.find((row) => row.materialId === "material-yarn-01")?.confirmed).toBe(false);
  });
});
