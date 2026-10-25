import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal, assertCannotReleaseToProduction } from "@/server/services/execution";
import { extractOrderPrep, saveOrderPrep } from "@/server/services/order-prep";
import { resetDatabase } from "./helpers";

const reorderText = readFileSync("fixtures/01-reorder.txt", "utf8");
const amendmentText = readFileSync("fixtures/05-size-amendment.txt", "utf8");

const validSizes = [
  { colorName: "海军蓝", breakdown: { XS: 60, S: 120, M: 240, L: 120, XL: 60 } },
  { colorName: "灰色", breakdown: { XS: 40, S: 80, M: 160, L: 80, XL: 40 } },
];

async function createReorderDraft() {
  const ingested = await ingestText({
    organizationId: IDS.orgDemo,
    userId: IDS.userSales,
    text: `${reorderText} 补资料测试 ${createId()}`,
    origin: "order-prep",
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

async function createThreeSizeOrder() {
  const scale = await prisma.sizeScale.create({
    data: {
      id: createId(),
      organizationId: IDS.orgDemo,
      name: "三码",
      sizesJson: JSON.stringify(["S", "M", "L"]),
    },
  });
  const styleId = "style-st-26002";
  await prisma.sku.createMany({
    data: ["S", "M", "L"].flatMap((sizeCode) =>
      ["红色", "黑色"].map((colorName) => ({
        id: createId(),
        styleId,
        sizeScaleId: scale.id,
        colorName,
        sizeCode,
        skuCode: `ST26002-${colorName}-${sizeCode}-${createId().slice(0, 8)}`,
      })),
    ),
  });
  const latest = await prisma.styleVersion.findFirst({
    where: { styleId },
    orderBy: { versionNumber: "desc" },
  });
  const draft = await prisma.styleVersion.create({
    data: {
      id: createId(),
      styleId,
      versionNumber: (latest?.versionNumber ?? 1) + 1,
      status: "draft",
      cuffType: latest?.cuffType ?? "常规",
      changeSummary: "非演示配比测试草稿",
      specNotes: "",
    },
  });
  const order = await prisma.salesOrder.create({
    data: {
      id: createId(),
      organizationId: IDS.orgDemo,
      orderNo: `TEST-ORD-${createId().slice(0, 8)}`,
      customerId: IDS.customerNorthshore,
      status: "draft",
      productionReadiness: "blocked_incomplete_spec",
      notes: "非固定演示订单，不得套用海军蓝演示尺码",
      lines: {
        create: {
          id: createId(),
          styleId,
          styleVersionId: draft.id,
          totalQuantity: 200,
          colors: {
            create: [
              { id: createId(), colorName: "红色", quantity: 80 },
              { id: createId(), colorName: "黑色", quantity: 120 },
            ],
          },
        },
      },
    },
  });
  await prisma.taskItem.create({
    data: {
      id: createId(),
      organizationId: IDS.orgDemo,
      title: "补齐各尺码数量",
      kind: "missing_size_breakdown",
      status: "open",
      blocking: true,
      relatedOrderId: order.id,
      relatedStyleId: styleId,
    },
  });
  return order.id;
}

describe("订单补充资料", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("色尺对齐并记录罗纹后关闭尺码任务，历史批准版本不变，也不能投产", async () => {
    const orderId = await createReorderDraft();
    const v1Before = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    const draftBefore = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: { version: true } } },
    });
    const draftVersionNumber = draftBefore.lines[0]?.version?.versionNumber;

    const result = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹，克重与缩水待测，未完成材料批准",
      expectedUpdatedAt: await stamp(orderId),
    });

    expect(result.sizeTaskStatus).toBe("done");
    expect(result.ribTaskStatus).toBe("open");
    expect(result.productionReadiness).toBe("blocked_unapproved_spec");
    expect(result.versionStatus).toBe("draft");
    expect(result.versionNumber).toBe(draftVersionNumber);
    expect(result.message).toContain("罗纹规格待批准");
    expect(result.requestedDeliveryDate).toBeNull();

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        lines: { include: { colors: { include: { sizes: true } }, version: true } },
        tasks: true,
      },
    });
    expect(order.requestedDeliveryDate).toBeNull();
    const navy = order.lines[0]?.colors.find((row) => row.colorName === "海军蓝");
    expect(navy?.sizes.map((row) => row.quantity).sort((a, b) => a - b)).toEqual([60, 60, 120, 120, 240]);
    expect(order.tasks.find((task) => task.kind === "missing_size_breakdown")?.status).toBe("done");
    expect(order.tasks.find((task) => task.kind === "missing_rib_spec")?.status).toBe("open");
    expect(order.tasks.find((task) => task.kind === "missing_delivery_year")?.status).toBe("open");
    expect(order.lines[0]?.version?.status).toBe("draft");
    expect(order.lines[0]?.version?.specNotes).toContain("2x2 罗纹");

    const v1After = await prisma.styleVersion.findUniqueOrThrow({ where: { id: IDS.versionSt26018V1 } });
    expect(v1After.status).toBe("approved");
    expect(v1After.cuffType).toBe(v1Before.cuffType);
    expect(v1After.specNotes).toBe(v1Before.specNotes);
    await expect(assertCannotReleaseToProduction(orderId)).rejects.toThrow("不能批准投产");
  });

  it("合计不一致时仍保存未完成草稿，不关闭尺码任务，不标可投产", async () => {
    const orderId = await createReorderDraft();
    const result = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: [{ colorName: "海军蓝", breakdown: { XS: 1, S: 1, M: 1, L: 1, XL: 1 } }],
      expectedUpdatedAt: await stamp(orderId),
    });

    expect(result.sizeTaskStatus).toBe("open");
    expect(result.productionReadiness).toBe("blocked_incomplete_spec");
    expect(result.message).toContain("尚未对齐");

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: { colors: { include: { sizes: true } } } }, tasks: true },
    });
    const navy = order.lines[0]?.colors.find((row) => row.colorName === "海军蓝");
    expect(navy?.sizes.reduce((sum, row) => sum + row.quantity, 0)).toBe(5);
    const grey = order.lines[0]?.colors.find((row) => row.colorName === "灰色");
    expect(grey?.sizes).toHaveLength(0);
    expect(order.tasks.find((task) => task.kind === "missing_size_breakdown")?.status).toBe("open");
    await expect(assertCannotReleaseToProduction(orderId)).rejects.toThrow("不能批准投产");
  });

  it("色尺对齐但缺少规格时不关闭罗纹任务，也不因保存解除限制", async () => {
    const orderId = await createReorderDraft();
    const result = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(result.sizeTaskStatus).toBe("done");
    expect(result.ribTaskStatus).toBe("open");
    expect(result.productionReadiness).toBe("blocked_incomplete_spec");
    expect(result.message).toContain("罗纹规格尚未记录");
  });

  it("重复提交同一内容不产生重复尺码或审计记录", async () => {
    const orderId = await createReorderDraft();
    const first = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: await stamp(orderId),
    });
    const second = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: first.updatedAt,
    });
    const staleRetry = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: first.updatedAt,
    });

    expect(second.reused).toBe(true);
    expect(staleRetry.reused).toBe(true);
    const sizes = await prisma.orderSizeQty.count({
      where: { color: { line: { orderId } } },
    });
    expect(sizes).toBe(10);
    const audits = await prisma.auditEvent.count({
      where: { entityId: orderId, action: "order.prep_saved" },
    });
    expect(audits).toBe(1);
  });

  it("资料已被他人修改且内容不同时提示冲突", async () => {
    const orderId = await createReorderDraft();
    const original = await stamp(orderId);
    await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      expectedUpdatedAt: original,
    });
    await expect(
      saveOrderPrep({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        orderId,
        sizes: [{ colorName: "海军蓝", breakdown: { M: 600 } }],
        expectedUpdatedAt: original,
      }),
    ).rejects.toThrow("资料已被他人修改");
  });

  it("未提供的单元格保持未知，不自动平均分配，也不套用演示配比", async () => {
    const orderId = await createThreeSizeOrder();
    const result = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: [{ colorName: "红色", breakdown: { S: 80 } }],
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(result.sizeCodes).toEqual(["S", "M", "L"]);
    expect(result.sizeTaskStatus).toBe("open");

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: { include: { colors: { include: { sizes: true } } } } },
    });
    const red = order.lines[0]?.colors.find((row) => row.colorName === "红色");
    const black = order.lines[0]?.colors.find((row) => row.colorName === "黑色");
    expect(red?.sizes).toEqual([expect.objectContaining({ sizeCode: "S", quantity: 80 })]);
    expect(black?.sizes).toHaveLength(0);
    expect(red?.sizes.some((row) => row.sizeCode === "XS")).toBe(false);
  });

  it("从客户补充消息提取后需确认才写入，未知消息不假装已理解", async () => {
    const orderId = await createReorderDraft();
    const preview = await extractOrderPrep({
      organizationId: IDS.orgDemo,
      orderId,
      text: amendmentText,
    });
    expect(preview.calledLiveModel).toBe(false);
    expect(preview.mode).toBe("mock");
    expect(preview.notes.some((note) => note.includes("未调用真实模型") || note.includes("演示"))).toBe(true);
    expect(preview.conflicts).toHaveLength(0);
    expect(preview.sizes.find((row) => row.colorName === "海军蓝")?.breakdown.XS?.quantity).toBe(60);
    expect(preview.ribSpec?.value).toContain("2x2");

    const before = await prisma.orderSizeQty.count({ where: { color: { line: { orderId } } } });
    expect(before).toBe(0);

    const saved = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: preview.sizes
        .filter((row) => row.applicable)
        .map((row) => ({
          colorName: row.colorName,
          breakdown: Object.fromEntries(
            Object.entries(row.breakdown)
              .filter(([, cell]) => cell.kind !== "conflict" && cell.quantity != null)
              .map(([sizeCode, cell]) => [sizeCode, cell.quantity as number]),
          ),
        })),
      ribSpec: preview.ribSpec?.value ?? null,
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(saved.sizeTaskStatus).toBe("done");
    expect(saved.message).toContain("罗纹规格待批准");

    const unknown = await extractOrderPrep({
      organizationId: IDS.orgDemo,
      orderId,
      text: "客户说尽快安排，别耽误。",
    });
    expect(unknown.sizes.every((row) => Object.keys(row.breakdown).length === 0)).toBe(true);
    expect(unknown.missing.length).toBeGreaterThan(0);
    expect(unknown.notes.join("")).toMatch(/未调用真实模型|无法在演示规则内理解/);
  });

  it("确认交期年份后才写入确认交期，推断年不能自动当真", async () => {
    const orderId = await createReorderDraft();
    const created = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { tasks: true },
    });
    expect(created.requestedDeliveryDate).toBeNull();
    expect(created.requestedDeliveryText).toMatch(/10月20日/);
    expect(created.tasks.find((task) => task.kind === "missing_delivery_year")?.status).toBe("open");

    const withoutYear = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(withoutYear.requestedDeliveryDate).toBeNull();

    const stillOpen = await prisma.taskItem.findFirst({
      where: { relatedOrderId: orderId, kind: "missing_delivery_year" },
    });
    expect(stillOpen?.status).toBe("open");

    const confirmed = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      confirmedDeliveryDate: "2026-10-20",
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(confirmed.requestedDeliveryDate).toBe("2026-10-20");
    expect(confirmed.message).toContain("交期年份已确认");

    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { tasks: true },
    });
    expect(order.requestedDeliveryDate).toBe("2026-10-20");
    expect(order.deliveryYearInference).toContain("不是原文已写明的事实");
    expect(order.tasks.find((task) => task.kind === "missing_delivery_year")?.status).toBe("done");

    const otherYear = await saveOrderPrep({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      orderId,
      sizes: validSizes,
      ribSpec: "2x2 罗纹",
      confirmedDeliveryDate: "2025-10-20",
      expectedUpdatedAt: await stamp(orderId),
    });
    expect(otherYear.requestedDeliveryDate).toBe("2025-10-20");
  });

  it("工厂角色不能补齐订单资料", async () => {
    const orderId = await createReorderDraft();
    await expect(
      saveOrderPrep({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        orderId,
        sizes: validSizes,
        expectedUpdatedAt: await stamp(orderId),
      }),
    ).rejects.toThrow("无权");
  });
});
