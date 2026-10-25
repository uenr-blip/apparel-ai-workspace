import { beforeEach, describe, expect, it } from "vitest";
import { leftoverNextStep } from "@/server/domain/leftover-next";
import { todayInboundJobs, todayLeftoverJobs, todayTransferJobs } from "@/server/domain/today-warehouse";
import { IDS } from "@/lib/constants";
import { getTodayWarehouse } from "@/server/services/today-warehouse";
import { resetDatabase } from "./helpers";

const leftoverA = leftoverNextStep({
  started: false,
  comparable: true,
  freeStock: "120",
  adopted: null,
});

describe("今日仓分拣", () => {
  it("公司有料在库、厂里不够，才进该调到厂；未到料和已开裁不进", () => {
    const jobs = todayTransferJobs([
      {
        orderId: "o-move",
        orderNo: "ORD-MOVE",
        factoryName: "云杉",
        started: false,
        leftover: leftoverA,
        lines: [
          {
            materialId: "mat-1",
            materialCode: "MAT-1",
            materialName: "棉毛布",
            unit: "m",
            remaining: "80",
            companyOnHand: "100",
            atFactory: "0",
            blocker: "未调到厂",
          },
        ],
      },
      {
        orderId: "o-buy",
        orderNo: "ORD-BUY",
        factoryName: "云杉",
        started: false,
        leftover: leftoverA,
        lines: [
          {
            materialId: "mat-1",
            materialCode: "MAT-1",
            materialName: "棉毛布",
            unit: "m",
            remaining: "800",
            companyOnHand: "100",
            atFactory: "0",
            blocker: "未到料",
          },
        ],
      },
      {
        orderId: "o-cut",
        orderNo: "ORD-CUT",
        factoryName: "云杉",
        started: true,
        leftover: leftoverNextStep({ started: true, comparable: true, freeStock: "10", adopted: null }),
        lines: [
          {
            materialId: "mat-1",
            materialCode: "MAT-1",
            materialName: "棉毛布",
            unit: "m",
            remaining: "80",
            companyOnHand: "100",
            atFactory: "0",
            blocker: "未调到厂",
          },
        ],
      },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      orderNo: "ORD-MOVE",
      materialCode: "MAT-1",
      action: "调到厂",
      href: "/orders/o-move#material-supply",
    });
  });

  it("有可占余料才进余料待办；补购 B 和已占住不进", () => {
    const jobs = todayLeftoverJobs([
      {
        orderId: "o-a",
        orderNo: "ORD-A",
        factoryName: "云杉",
        started: false,
        leftover: leftoverA,
        lines: [],
      },
      {
        orderId: "o-b",
        orderNo: "ORD-B",
        factoryName: "云杉",
        started: false,
        leftover: leftoverNextStep({ started: false, comparable: true, freeStock: "0", adopted: null }),
        lines: [],
      },
      {
        orderId: "o-held",
        orderNo: "ORD-HELD",
        factoryName: "云杉",
        started: false,
        leftover: leftoverNextStep({
          started: false,
          comparable: true,
          freeStock: "120",
          adopted: { optionCode: "A", status: "adopted" },
        }),
        lines: [],
      },
    ]);
    expect(jobs.map((job) => job.orderNo)).toEqual(["ORD-A"]);
    expect(jobs[0]?.recommend).toBe("A");
    expect(jobs[0]?.href).toBe("/orders/o-a#material-supply");
  });

  it("在途未收才进今日到料；已收和空在途不进，不编造本单占用", () => {
    const jobs = todayInboundJobs([
      {
        id: "lot-in",
        materialId: "mat-1",
        materialCode: "MAT-1",
        materialName: "棉毛布",
        colorName: "海军蓝",
        qtyInbound: "200",
        inboundEta: "2026-09-28",
        locationName: "清河",
        orderNos: [],
      },
      {
        id: "lot-empty",
        materialId: "mat-1",
        materialCode: "MAT-1",
        materialName: "棉毛布",
        colorName: "海军蓝",
        qtyInbound: "0",
        inboundEta: "2026-09-28",
        locationName: "清河",
        orderNos: ["ORD-X"],
      },
      {
        id: "lot-stock",
        materialId: "mat-1",
        materialCode: "MAT-1",
        materialName: "棉毛布",
        colorName: "海军蓝",
        qtyInbound: "0",
        inboundEta: null,
        locationName: "原料库",
        orderNos: [],
      },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      lotId: "lot-in",
      eta: "2026-09-28",
      qtyInbound: "200",
      orderNos: [],
      href: "/resources/lots/lot-in",
    });
  });
});

describe("今日仓查阅", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("演示库列出可占余料和在途未收，不出现进出库菜单，隔离第二组织", async () => {
    const today = await getTodayWarehouse(IDS.orgDemo, { role: "manager", factoryId: null });
    expect(today.navMenus).toEqual([]);
    expect(today.facts.join(" ")).toContain("调拨不是领用");
    expect(today.facts.join(" ")).toContain("正式采购未下达");
    expect(today.leftover.some((job) => job.orderNo === "DEMO-ORD-002" && job.recommend === "A")).toBe(true);
    expect(today.inbound.some((job) => job.lotId === "lot-mat001-inb" && job.eta === "2026-09-28")).toBe(true);
    expect(today.inbound.find((job) => job.lotId === "lot-mat001-inb")?.orderNos).toEqual([]);

    const iso = await getTodayWarehouse(IDS.orgIso, { role: "salesperson", factoryId: null });
    expect(iso.leftover.some((job) => job.orderNo === "DEMO-ORD-002")).toBe(false);
    expect(iso.inbound.some((job) => job.lotId === "lot-mat001-inb")).toBe(false);

    const factory = await getTodayWarehouse(IDS.orgDemo, { role: "factory", factoryId: IDS.factoryYunshan });
    expect(factory.inbound).toEqual([]);
    expect(factory.leftover.some((job) => job.orderNo === "DEMO-ORD-002")).toBe(true);
    expect(factory.transfer.every((job) => job.factoryName)).toBe(true);
  });
});
