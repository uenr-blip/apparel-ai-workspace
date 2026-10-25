import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { getOrderMaterialSupply } from "@/server/services/order-material-supply";
import { getProductionBoard } from "@/server/services/production-board";
import { resetDatabase } from "./helpers";

describe("一单料况", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("未投产缺料单显示未到料，已开裁单不因此进入卡面料", async () => {
    const shortage = await getOrderMaterialSupply(IDS.orgDemo, {
      id: IDS.orderShortage,
      factoryId: IDS.factoryYunshan,
      started: false,
    });
    expect(shortage.status).toBe("blocked");
    expect(shortage.blockers).toContain("未到料");
    expect(shortage.lines[0]?.companyOnHand).toBe("170");
    expect(shortage.lines[0]?.atFactory).toBe("0");
    expect(Number(shortage.lines[0]?.gross ?? 0)).toBeGreaterThan(170);
    expect(shortage.canCut).toBe(false);
    expect(shortage.leftover.kind).toBe("ready");
    expect(shortage.leftover.blockers).toContain("余料未占");

    const shipped = await getOrderMaterialSupply(IDS.orgDemo, {
      id: "order-demo-005",
      factoryId: IDS.factoryYunshan,
      started: true,
    });
    expect(shipped.label).toBe("已开裁");
    expect(shipped.blockers).toEqual([]);

    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const blocked = board.rows.find((row) => row.orderNo === "DEMO-ORD-002");
    const done = board.rows.find((row) => row.orderNo === "DEMO-ORD-005");
    expect(blocked?.watch.fabric).toEqual(expect.arrayContaining(["未到料", "余料未占", "物料到货待核验"]));
    expect(blocked?.cut.label).toBe("未到料");
    expect(done?.cut.label).toBe("已开裁");
    expect(done?.watch.fabric).not.toContain("未调到厂");
  });
});
