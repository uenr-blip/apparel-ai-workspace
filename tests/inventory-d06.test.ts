import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { companyOwnedOnHand, consumeInventory, transferInventory } from "@/server/services/inventory-move";
import { resetDatabase } from "./helpers";

describe("D06 调拨与耗用分开", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("原料库200调100到外协厂，公司合计仍200；再领40后未耗用160，凭证分开", async () => {
    const first = await transferInventory({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      lotId: IDS.lotD06Wh,
      toLocationId: IDS.factoryYunshan,
      qty: "100",
      idempotencyKey: "xfer-d06-100",
    });
    expect(first.reused).toBe(false);
    expect(first.movement.kind).toBe("transfer");
    expect(first.companyOnHand).toBe("200");
    expect(first.fromOnHand).toBe("100");
    expect(first.toOnHand).toBe("100");

    const totals = await companyOwnedOnHand(IDS.orgDemo, IDS.materialD06);
    expect(totals).toBe("200");

    const consume = await consumeInventory({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      lotId: first.toLotId,
      qty: "40",
      idempotencyKey: "consume-d06-40",
    });
    expect(consume.movement.kind).toBe("consume");
    expect(consume.movement.id).not.toBe(first.movement.id);
    expect(consume.companyOnHand).toBe("160");

    const transferRow = await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: first.movement.id } });
    expect(transferRow.kind).toBe("transfer");
    expect(transferRow.qty).toBe("100");

    const after = await prisma.inventoryLot.findMany({
      where: { organizationId: IDS.orgDemo, materialId: IDS.materialD06 },
    });
    const warehouse = after.find((lot) => lot.locationId === IDS.warehouse);
    const factory = after.find((lot) => lot.locationId === IDS.factoryYunshan);
    expect(warehouse?.qtyOnHand).toBe("100");
    expect(factory?.qtyOnHand).toBe("60");
  });

  it("同一幂等键不重复调拨；业务员不能过账；不能把调拨改成领用", async () => {
    const first = await transferInventory({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      lotId: IDS.lotD06Wh,
      toLocationId: IDS.factoryYunshan,
      qty: "100",
      idempotencyKey: "xfer-d06-100",
    });
    expect(first.reused).toBe(false);
    const again = await transferInventory({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      lotId: IDS.lotD06Wh,
      toLocationId: IDS.factoryYunshan,
      qty: "100",
      idempotencyKey: "xfer-d06-100",
    });
    expect(again.reused).toBe(true);

    await expect(
      transferInventory({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        lotId: IDS.lotD06Wh,
        toLocationId: IDS.factoryYunshan,
        qty: "10",
        idempotencyKey: "sales-xfer",
      }),
    ).rejects.toThrow("无权");

    await expect(
      consumeInventory({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        lotId: IDS.lotD06Wh,
        qty: "10",
        idempotencyKey: "consume-from-wh",
      }),
    ).rejects.toThrow("原料库不能直接领用");
  });
});
