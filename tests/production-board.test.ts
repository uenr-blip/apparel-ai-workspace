import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { summarizeProduction } from "@/server/domain/production";
import { filterProductionRows, getProductionBoard, parseBoardView, recordProductionQty } from "@/server/services/production-board";
import { resetDatabase } from "./helpers";

const expected = JSON.parse(readFileSync("fixtures/expected-cases.json", "utf8")) as {
  productionConservationCase: {
    startedPieces: number;
    scrappedPieces: number;
    workInProgressPieces: number;
    goodProducedPieces: number;
    goodShippedPieces: number;
    goodRemainingPieces: number;
    incorrectScrapInferencePieces: number;
  };
};

describe("生产数量守恒", () => {
  it("投产1020、报废10、在制15、合格995、发运980、余货15，不能把40记成报废", () => {
    const c = expected.productionConservationCase;
    const summary = summarizeProduction([
      { kind: "started", quantity: c.startedPieces },
      { kind: "scrapped", quantity: c.scrappedPieces },
      { kind: "wip", quantity: c.workInProgressPieces },
      { kind: "good", quantity: c.goodProducedPieces },
      { kind: "shipped", quantity: c.goodShippedPieces },
    ]);
    expect(summary.started).toBe(1020);
    expect(summary.scrapped).toBe(10);
    expect(summary.wip).toBe(15);
    expect(summary.good).toBe(995);
    expect(summary.shipped).toBe(980);
    expect(summary.leftover).toBe(15);
    expect(summary.incorrectScrapInference).toBe(40);
    expect(summary.scrapped).not.toBe(summary.incorrectScrapInference);
    expect(summary.stage).toBe("leftover_unshipped");
  });
});

describe("生产进度台", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("DEMO-ORD-005 显示真实余货，不出现裁床完成率，阻塞来自任务", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(row).toMatchObject({
      started: 1020,
      scrapped: 10,
      wip: 15,
      good: 995,
      shipped: 980,
      leftover: 15,
      stage: "leftover_unshipped",
    });
    expect(row?.facts.join(" ")).toContain("不能把投产减已发运记成报废");
    expect(board.facts.join(" ")).not.toContain("裁床完成率");
    expect(board.facts.join(" ")).not.toContain("标准工时");
    expect(board.packingEnabled).toBe(true);
    expect(row?.packing.shippedTotal).toBe(980);

    const blocked = board.rows.find((item) => item.orderNo === "DEMO-ORD-002");
    expect(blocked?.started).toBe(0);
    expect(blocked?.stage).toBe("not_started");
    expect(blocked?.exceptions.join(" ")).toContain("物料到货待核验");
    expect(row?.owners.factoryName).toBe("云杉服装工厂");
    expect(row?.progress.label).toContain("余货 15");
    expect(row?.progress.label).not.toMatch(/%|完成率/);
    const leftover = filterProductionRows(board.rows, "leftover");
    expect(leftover.every((item) => item.leftover > 0)).toBe(true);
    expect(leftover.some((item) => item.orderNo === "DEMO-ORD-005")).toBe(true);
    const fabric = filterProductionRows(board.rows, "fabric");
    expect(fabric.some((item) => item.orderNo === "DEMO-ORD-002")).toBe(true);
    expect(fabric.some((item) => item.orderNo === "DEMO-ORD-005")).toBe(false);
    expect(blocked?.watch.fabric).toContain("未到料");
    expect(blocked?.watch.fabric).toContain("余料未占");
    expect(row?.cut.label).toBe("已开裁");
    const color = filterProductionRows(board.rows, "color");
    expect(color.some((item) => item.orderNo === "DEMO-ORD-004")).toBe(true);
    expect(parseBoardView("fabric")).toBe("fabric");
    expect(parseBoardView("nope")).toBe("all");
    expect(parseBoardView("packable")).toBe("packable");
    const notStarted = filterProductionRows(board.rows, "not_started");
    expect(notStarted.some((item) => item.orderNo === "DEMO-ORD-002")).toBe(true);
    expect(notStarted.some((item) => item.orderNo === "DEMO-ORD-005")).toBe(false);
    const scrap = filterProductionRows(board.rows, "scrap");
    expect(scrap.some((item) => item.orderNo === "DEMO-ORD-005")).toBe(true);
    const packable = filterProductionRows(board.rows, "packable");
    expect(packable.some((item) => item.orderNo === "DEMO-ORD-005")).toBe(true);
    expect(packable.every((item) => item.packable > 0)).toBe(true);
    expect(filterProductionRows(board.rows, "rework")).toEqual([]);
    expect(row?.rework).toBe(0);
    expect(row?.progress.label).toContain("报废 10");
  });

  it("查阅视图能找出返工、生产中、已发完，不出现开裁车间后整夹", async () => {
    await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-005",
      kind: "rework",
      quantity: 3,
      idempotencyKey: "rework-view-005",
    });
    await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-008",
      kind: "started",
      quantity: 20,
      idempotencyKey: "start-view-008",
    });
    await prisma.productionQty.createMany({
      data: [
        { id: "pq-view-001-start", orderId: "order-demo-001", kind: "started", quantity: 10, idempotencyKey: "view-001-start" },
        { id: "pq-view-001-good", orderId: "order-demo-001", kind: "good", quantity: 10, idempotencyKey: "view-001-good" },
        { id: "pq-view-001-ship", orderId: "order-demo-001", kind: "shipped", quantity: 10, idempotencyKey: "view-001-ship" },
      ],
    });

    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    expect(board.rows.find((item) => item.orderNo === "DEMO-ORD-005")?.rework).toBe(3);
    expect(filterProductionRows(board.rows, "rework").some((item) => item.orderNo === "DEMO-ORD-005")).toBe(true);
    expect(filterProductionRows(board.rows, "in_progress").some((item) => item.orderNo === "DEMO-ORD-008")).toBe(true);
    expect(filterProductionRows(board.rows, "in_progress").some((item) => item.orderNo === "DEMO-ORD-005")).toBe(false);
    expect(filterProductionRows(board.rows, "shipped").some((item) => item.orderNo === "DEMO-ORD-001")).toBe(true);
    expect(filterProductionRows(board.rows, "shipped").some((item) => item.orderNo === "DEMO-ORD-005")).toBe(false);
    expect(JSON.stringify(board.facts)).not.toContain("裁床单");
    expect(JSON.stringify(board.facts)).not.toContain("车间交货");
    expect(JSON.stringify(board.facts)).not.toContain("后道交货");
  });

  it("色尺在弹窗里看订单件数，不编造开裁车间后整", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const historical = board.rows.find((item) => item.orderNo === "DEMO-ORD-001");
    expect(historical?.colorSize.productionByProcess).toBe(false);
    expect(historical?.colorSize.sizeCodes).toEqual(["XS", "S", "M", "L", "XL"]);
    const navy = historical?.colorSize.colors.find((color) => color.colorName === "海军蓝");
    expect(navy).toMatchObject({ ordered: 500, filled: 500, sizes: { XS: 50, S: 100, M: 200, L: 100, XL: 50 } });
    expect(historical?.colorSize.matrix.map((row) => `${row.colorName}-${row.sizeCode}`)).toEqual([
      "海军蓝-XS",
      "海军蓝-S",
      "海军蓝-M",
      "海军蓝-L",
      "海军蓝-XL",
      "灰色-XS",
      "灰色-S",
      "灰色-M",
      "灰色-L",
      "灰色-XL",
    ]);
    expect(historical?.colorSize.matrix.find((row) => row.colorName === "海军蓝" && row.sizeCode === "M")).toMatchObject({
      ordered: 200,
      started: 0,
      good: 0,
      shipped: 0,
    });
    expect(historical?.colorSize.columns).toEqual(["订单", "投产", "合格", "发运", "余货"]);
    expect(historical?.colorSize.columns.join(" ")).not.toMatch(/开裁|车间|后整/);
    expect(historical?.colorSize.note).toContain("不是开裁/车间/后整件数");
    expect(historical?.colorSize.note).toContain("产量可按本单色尺登记");
    expect(historical?.packing.plans).toEqual([]);

    const partial = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(partial?.colorSize.colors.map((color) => color.colorName)).toEqual(["海军蓝", "灰色"]);
    expect(partial?.colorSize.sizeCodes).toEqual(["S", "M", "L"]);
    expect(partial?.colorSize.note).toContain("不是开裁/车间/后整件数");
    expect(JSON.stringify(board)).not.toContain("裁床完成率");
  });

  it("工厂只看本厂订单；外组织看不到演示单", async () => {
    await prisma.salesOrder.create({
      data: {
        id: "order-wudao",
        organizationId: IDS.orgDemo,
        orderNo: "DEMO-ORD-WUDAO",
        customerId: IDS.customerNorthshore,
        factoryId: "party-wudao",
        status: "confirmed",
        productionReadiness: "ready_for_production",
        lines: {
          create: {
            id: "line-wudao",
            styleId: "style-st-26001",
            totalQuantity: 10,
          },
        },
      },
    });
    const factoryBoard = await getProductionBoard(IDS.orgDemo, { role: "factory", factoryId: IDS.factoryYunshan });
    expect(factoryBoard.rows.some((row) => row.orderNo === "DEMO-ORD-005")).toBe(true);
    expect(factoryBoard.rows.some((row) => row.orderNo === "DEMO-ORD-WUDAO")).toBe(false);

    const iso = await getProductionBoard(IDS.orgIso, { role: "salesperson", factoryId: null });
    expect(iso.rows.some((row) => row.orderNo === "DEMO-ORD-005")).toBe(false);
  });

  it("同一幂等键重复上报只记一次；返工不增加合格", async () => {
    const first = await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-005",
      kind: "started",
      quantity: 1020,
      idempotencyKey: "start-005",
    });
    expect(first.reused).toBe(true);

    const rework = await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      kind: "rework",
      quantity: 8,
      idempotencyKey: "rework-005",
    });
    expect(rework.reused).toBe(false);

    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(row?.good).toBe(995);
    expect(row?.started).toBe(1020);

    await expect(
      recordProductionQty({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        factoryId: null,
        orderId: "order-demo-005",
        kind: "good",
        quantity: 1,
        idempotencyKey: "sales-good",
      }),
    ).rejects.toThrow("无权登记产量");

    await expect(
      recordProductionQty({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        factoryId: null,
        orderId: "order-demo-005",
        kind: "good",
        quantity: 1,
        idempotencyKey: "iso-good",
      }),
    ).rejects.toThrow("订单不存在");
  });

  it("选订单后按本单色尺登记，合计进整单，不接受本单没有的颜色", async () => {
    const recorded = await recordProductionQty({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-005",
      kind: "started",
      idempotencyKey: "start-005-navy-sm",
      lines: [
        { colorName: "海军蓝", sizeCode: "S", quantity: 2 },
        { colorName: "海军蓝", sizeCode: "M", quantity: 3 },
      ],
    });
    expect(recorded.reused).toBe(false);
    expect(recorded.record.quantity).toBe(5);
    expect(recorded.lines).toEqual([
      { colorName: "海军蓝", sizeCode: "S", quantity: 2 },
      { colorName: "海军蓝", sizeCode: "M", quantity: 3 },
    ]);

    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(row?.started).toBe(1025);
    expect(row?.colorSize.note).toContain("产量可按本单色尺登记");
    expect(row?.colorSize.note).toContain("不是开裁/车间/后整件数");

    await expect(
      recordProductionQty({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        factoryId: IDS.factoryYunshan,
        orderId: "order-demo-005",
        kind: "started",
        idempotencyKey: "start-005-wrong-color",
        lines: [{ colorName: "酒红", sizeCode: "S", quantity: 1 }],
      }),
    ).rejects.toThrow("颜色不在本单色尺里");

    await expect(
      recordProductionQty({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        factoryId: IDS.factoryYunshan,
        orderId: "order-demo-005",
        kind: "started",
        quantity: 9,
        idempotencyKey: "start-005-mismatch",
        lines: [{ colorName: "海军蓝", sizeCode: "S", quantity: 2 }],
      }),
    ).rejects.toThrow("色尺合计必须等于件数");
  });
});
