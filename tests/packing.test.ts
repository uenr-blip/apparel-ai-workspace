import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  availableFinishedGoods,
  summarizePackingPlan,
  weightStatusFor,
} from "@/server/domain/packing";
import { getProductionBoard } from "@/server/services/production-board";
import {
  createPackingDraft,
  occupyPackingPlan,
  shipPackingPlan,
} from "@/server/services/packing";
import { resetDatabase } from "./helpers";

const mixedCartons = [
  {
    cartonNo: "C-L1",
    lines: [
      { colorName: "海军蓝", sizeCode: "S", quantity: 4 },
      { colorName: "海军蓝", sizeCode: "M", quantity: 3 },
      { colorName: "灰色", sizeCode: "S", quantity: 2 },
      { colorName: "灰色", sizeCode: "M", quantity: 1 },
    ],
  },
  {
    cartonNo: "C-L2",
    lines: [
      { colorName: "海军蓝", sizeCode: "L", quantity: 3 },
      { colorName: "灰色", sizeCode: "L", quantity: 2 },
    ],
  },
];

describe("E03 混装数量", () => {
  it("两种颜色多尺码同箱，箱明细合计等于箱件数，所有箱汇总等于本次发运", () => {
    const plan = summarizePackingPlan(mixedCartons);
    expect(plan.cartons[0]).toMatchObject({ cartonNo: "C-L1", qty: 10 });
    expect(plan.cartons[1]).toMatchObject({ cartonNo: "C-L2", qty: 5 });
    expect(plan.total).toBe(15);
    expect(plan.colors).toEqual(["海军蓝", "灰色"]);
    expect(plan.sizeCodes.sort()).toEqual(["L", "M", "S"]);
  });

  it("未录重量只能是待称重，不能冒充实测", () => {
    expect(weightStatusFor({ netWeight: null, grossWeight: null, claimed: "measured" })).toBe("pending");
    expect(weightStatusFor({ netWeight: null, grossWeight: null })).toBe("pending");
    expect(weightStatusFor({ netWeight: "12.5", grossWeight: "13.0", claimed: "measured" })).toBe("measured");
  });

  it("可用成品 = 合格 − 已发运 − 已装箱占用，占用不能把余货算成报废", () => {
    expect(availableFinishedGoods({ good: 995, shipped: 980, occupied: 0 })).toBe(15);
    expect(availableFinishedGoods({ good: 995, shipped: 980, occupied: 10 })).toBe(5);
  });
});

describe("E03 装箱草稿占用发运", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("DEMO-ORD-005 已发运 980 有混装逐箱明细；草稿不算实发", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(board.packingEnabled).toBe(true);
    expect(row?.shipped).toBe(980);
    expect(row?.leftover).toBe(15);
    expect(row?.occupied).toBe(0);
    expect(row?.packable).toBe(15);
    expect(row?.packing.shippedTotal).toBe(980);
    expect(row?.packing.plans.some((plan) => plan.status === "shipped" && plan.total === 980)).toBe(true);
    const shipped = row?.packing.plans.find((plan) => plan.status === "shipped");
    expect(shipped?.cartons.some((carton) => carton.colors.length >= 2 && carton.sizeCodes.length >= 2)).toBe(true);
    expect(shipped?.cartons.reduce((sum, carton) => sum + carton.qty, 0)).toBe(980);
    expect(shipped?.cartons.every((carton) => carton.weightStatus === "pending")).toBe(true);

    const draft = await createPackingDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      cartons: mixedCartons,
      idempotencyKey: "pack-leftover-15",
    });
    expect(draft.reused).toBe(false);
    expect(draft.plan.status).toBe("draft");
    expect(draft.plan.total).toBe(15);

    const afterDraft = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const leftover = afterDraft.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(leftover?.shipped).toBe(980);
    expect(leftover?.occupied).toBe(0);
    expect(leftover?.packable).toBe(15);
    expect(leftover?.packing.plans.some((plan) => plan.status === "draft" && plan.total === 15)).toBe(true);
  });

  it("确认占用后才扣可发；超发失败回滚；未确认不能出运", async () => {
    await expect(
      shipPackingPlan({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        factoryId: null,
        planId: "missing",
        idempotencyKey: "ship-missing",
      }),
    ).rejects.toThrow(/装箱方案|不存在/);

    const draft = await createPackingDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      cartons: mixedCartons,
      idempotencyKey: "pack-occupy-15",
    });
    await expect(
      shipPackingPlan({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        factoryId: null,
        planId: draft.plan.id,
        idempotencyKey: "ship-unconfirmed",
      }),
    ).rejects.toThrow("装箱方案未确认，不能算出运");

    const occupied = await occupyPackingPlan({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      planId: draft.plan.id,
      idempotencyKey: "occupy-15",
    });
    expect(occupied.plan.status).toBe("occupied");

    const afterOccupy = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = afterOccupy.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(row?.shipped).toBe(980);
    expect(row?.occupied).toBe(15);
    expect(row?.packable).toBe(0);
    expect(row?.leftover).toBe(15);

    await expect(
      createPackingDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        factoryId: null,
        orderId: "order-demo-005",
        cartons: mixedCartons,
        idempotencyKey: "pack-overship",
      }),
    ).rejects.toThrow("超过可用成品");

    const overshipCount = await prisma.packingPlan.count({
      where: { orderId: "order-demo-005", idempotencyKey: "pack-overship" },
    });
    expect(overshipCount).toBe(0);

    const shipped = await shipPackingPlan({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      planId: draft.plan.id,
      idempotencyKey: "ship-15",
    });
    expect(shipped.plan.status).toBe("shipped");
    expect(shipped.reused).toBe(false);

    const afterShip = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const done = afterShip.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(done?.shipped).toBe(995);
    expect(done?.occupied).toBe(0);
    expect(done?.leftover).toBe(0);
    expect(done?.packable).toBe(0);
    expect(done?.stage).toBe("shipped");
  });

  it("同一幂等键重复保存只建一稿；工厂隔离；销售不能确认出运", async () => {
    const first = await createPackingDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-005",
      cartons: mixedCartons,
      idempotencyKey: "pack-idem-15",
    });
    const second = await createPackingDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      orderId: "order-demo-005",
      cartons: mixedCartons,
      idempotencyKey: "pack-idem-15",
    });
    expect(second.reused).toBe(true);
    expect(second.plan.id).toBe(first.plan.id);

    await expect(
      createPackingDraft({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        factoryId: null,
        orderId: "order-demo-005",
        cartons: mixedCartons,
        idempotencyKey: "iso-pack",
      }),
    ).rejects.toThrow("订单不存在");

    await occupyPackingPlan({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      planId: first.plan.id,
      idempotencyKey: "occupy-idem",
    });
    await expect(
      shipPackingPlan({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        factoryId: null,
        planId: first.plan.id,
        idempotencyKey: "sales-ship",
      }),
    ).rejects.toThrow("无权确认出运");
  });
});
