import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { savePatternSheet } from "@/server/services/craft-sheet";
import { listFollowDesk, listFollowProducts, listSeasonBoard, saveFollowSheet, saveOrderMerch, createFollowSheet, openFollowAsOrder } from "@/server/services/order-merch";
import { createDevelopmentProject } from "@/server/services/development-create";
import { resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

describe("保存版单和跟单表", () => {
  it("并发重复新建跟单只产生一张，两个请求拿到同一张", async () => {
    const input = {
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "follow-concurrent-01",
      kind: "bulk",
      title: "并发建单",
      factoryName: "云杉服装工厂",
    };
    const results = await Promise.allSettled([createFollowSheet(input), createFollowSheet(input)]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const sheets = results.flatMap((result) => result.status === "fulfilled" ? [result.value.sheetId] : []);
    expect(new Set(sheets).size).toBe(1);
    expect(await prisma.orderMerchSheet.count({ where: { organizationId: IDS.orgDemo, title: "并发建单" } })).toBe(1);
  });

  it("两张跟单同时开生产订单会分配不同单号", async () => {
    const sheetIds: string[] = [];
    for (const index of [1, 2]) {
      const created = await createFollowSheet({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        idempotencyKey: `follow-number-create-${index}`,
        kind: "bulk",
        title: `并发开单 ${index}`,
        factoryName: "云杉服装工厂",
      });
      const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
      await saveFollowSheet({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        sheetId: sheet.id,
        expectedUpdatedAt: sheet.updatedAt.toISOString(),
        idempotencyKey: `follow-number-save-${index}`,
        factoryName: "云杉服装工厂",
        styles: [{ styleCode: "ST-26003", styleName: "亚麻衬衫", bulk: { colors: [{ guestColor: "海军蓝", qtyText: "12" }] } }],
      });
      sheetIds.push(sheet.id);
    }
    const results = await Promise.allSettled(sheetIds.map((sheetId, index) => openFollowAsOrder({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId,
      customerId: IDS.customerNorthshore,
      idempotencyKey: `follow-number-open-${index}`,
    })));
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const orderNos = results.flatMap((result) => result.status === "fulfilled" ? [result.value.orderNo] : []);
    expect(new Set(orderNos).size).toBe(2);
  });

  it("版单可保存，工厂不能改，不产生采购", async () => {
    const before = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const created = await createDevelopmentProject({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      name: "演示毛衣版单",
    });
    const project = await prisma.developmentProject.findUniqueOrThrow({ where: { id: created.projectId } });
    const base = {
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      projectId: project.id,
      expectedUpdatedAt: project.updatedAt.toISOString(),
      origin: "from_material",
      craftFamily: "sweater",
      sweater: { yarnComposition: "羊毛", yarnCount: "2/48", inStock: "unknown" },
    };
    await expect(
      savePatternSheet({ ...base, role: "factory", userId: IDS.userFactory, idempotencyKey: "pattern-deny-01" }),
    ).rejects.toThrow(/不能改版单/);
    const saved = await savePatternSheet({ ...base, role: "salesperson", idempotencyKey: "pattern-save-01" });
    expect(saved.reused).toBe(false);
    expect(saved.craftFamily).toBe("sweater");
    await expect(savePatternSheet({ ...base, role: "salesperson", expectedUpdatedAt: "stale", idempotencyKey: "pattern-stale-confirm" })).rejects.toThrow(/已变化/);
    const again = await savePatternSheet({
      ...base,
      role: "salesperson",
      expectedUpdatedAt: saved.expectedUpdatedAt,
      idempotencyKey: "pattern-save-02",
    });
    expect(again.reused).toBe(true);
    await expect(
      savePatternSheet({
        ...base,
        role: "salesperson",
        sweater: { yarnComposition: "棉", yarnCount: "2/48" },
        idempotencyKey: "pattern-save-03",
      }),
    ).rejects.toThrow(/已变化/);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(before);
  });

  it("大货写下不后，本季汇总不把该颜色算进要买数量，订单件数不变", async () => {
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: IDS.orderColorHold },
      include: { lines: true },
    });
    const qtyBefore = order.lines[0]?.totalQuantity;
    const readinessBefore = order.productionReadiness;
    const draftsBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const saved = await saveOrderMerch({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      orderId: order.id,
      expectedUpdatedAt: "",
      idempotencyKey: "merch-save-01",
      seasonCode: "SS27",
      styles: [
        {
          styleCode: "ST-A",
          styleName: "衬衫",
          craftFamily: "woven",
          salesSample: {
            composition: "100% cotton",
            shellConsumption: "1.5",
            shellPrice: "20",
            laborPrice: "9",
            progress: "已包完",
          },
          bulk: {
            inboundDate: "2026.10.10",
            shipDate: "10.24",
            button: "四眼",
            colors: [
              { guestColor: "灰色", factoryColorName: "灰", qtyText: "不下", metalBadge: "银色" },
              { guestColor: "海军蓝", factoryColorName: "藏青", qtyText: "100", metalBadge: "金色" },
            ],
          },
        },
        {
          styleCode: "ST-B",
          styleName: "毛衣",
          craftFamily: "sweater",
          salesSample: { composition: "羊毛", shellConsumption: "0.8", shellPrice: "30" },
          bulk: { colors: [{ guestColor: "米白", factoryColorName: "", qtyText: "50", metalBadge: "" }] },
        },
      ],
    });
    expect(saved.reused).toBe(false);
    expect(saved.styleCount).toBe(2);
    expect(saved.purchases.find((line) => line.styleCode === "ST-A")?.buyQty).toBe("150");
    expect(saved.purchases.find((line) => line.styleCode === "ST-B")?.buyQty).toBe("40");
    const board = await listSeasonBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const rows = board.rows.filter((item) => item.orderId === order.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((item) => item.styleCode).sort()).toEqual(["ST-A", "ST-B"]);
    expect(rows.find((item) => item.styleCode === "ST-A")?.colorQty).toContain("不下");
    expect(rows.find((item) => item.styleCode === "ST-A")?.progress).toBe("已包完");
    expect(board.counts.woven).toBe(1);
    expect(board.counts.sweater).toBe(1);
    expect(board.purchases.some((item) => item.price === "9")).toBe(false);
    const after = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
    expect(after.lines[0]?.totalQuantity).toBe(qtyBefore);
    expect(after.productionReadiness).toBe(readinessBefore);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(draftsBefore);
  });

  it("新建跟单不建生产订单，一单多款，不下不计入要买，工厂看不见未挂单的跟单", async () => {
    const ordersBefore = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });
    const draftsBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    await expect(
      createFollowSheet({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        idempotencyKey: "follow-deny-01",
        kind: "bulk",
        title: "SS27 演示大货",
        factoryName: "研色",
        seasonCode: "SS27",
      }),
    ).rejects.toThrow(/不能新建跟单/);
    const created = await createFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "follow-create-01",
      kind: "bulk",
      title: "SS27 演示大货",
      factoryName: "研色",
      seasonCode: "SS27",
    });
    const again = await createFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "follow-create-01",
      kind: "bulk",
      title: "SS27 演示大货",
      factoryName: "研色",
      seasonCode: "SS27",
    });
    expect(again.reused).toBe(true);
    expect(again.sheetId).toBe(created.sheetId);
    expect(await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } })).toBe(ordersBefore);
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    expect(sheet.salesOrderId).toBeNull();
    const saved = await saveFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: created.sheetId,
      expectedUpdatedAt: sheet.updatedAt.toISOString(),
      idempotencyKey: "follow-save-01",
      seasonCode: "SS27",
      factoryName: "研色",
      styles: [
        {
          styleCode: "SMS-1",
          styleName: "背心",
          craftFamily: "woven",
          salesSample: { composition: "棉", shellConsumption: "1.2", shellPrice: "10" },
          bulk: {
            po: "PO100094",
            button: "金色",
            fabricProgress: "布在染",
            colors: [
              { guestColor: "驼", qtyText: "不下", metalBadge: "金色" },
              { guestColor: "米白", qtyText: "20", metalBadge: "银色" },
            ],
          },
        },
        {
          styleCode: "SMS-2",
          styleName: "衬衫",
          craftFamily: "knit",
          salesSample: { composition: "麻", shellConsumption: "0.5", shellPrice: "8" },
          bulk: { colors: [{ guestColor: "蓝", qtyText: "10" }] },
        },
      ],
    });
    expect(saved.styleCount).toBe(2);
    expect(saved.purchases.find((line) => line.styleCode === "SMS-1")?.buyQty).toBe("24");
    expect(saved.purchases.find((line) => line.styleCode === "SMS-2")?.buyQty).toBe("5");
    const desk = await listFollowDesk(IDS.orgDemo, { role: "manager", factoryId: null });
    expect(desk.find((row) => row.id === created.sheetId)?.styleCount).toBe(2);
    const factoryDesk = await listFollowDesk(IDS.orgDemo, { role: "factory", factoryId: IDS.factoryYunshan });
    expect(factoryDesk.find((row) => row.id === created.sheetId)).toBeUndefined();
    const board = await listSeasonBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const rows = board.rows.filter((row) => row.orderId === created.sheetId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.href).toBe(`/orders/follow/${created.sheetId}`);
    expect(rows.every((row) => row.factoryName === "研色")).toBe(true);
    expect(rows.find((row) => row.styleCode === "SMS-1")?.progress).toContain("面料：布在染");
    const products = await listFollowProducts(IDS.orgDemo, { role: "manager", factoryId: null });
    const yanse = products.bulk.find((group) => group.factoryName === "研色");
    expect(yanse?.styles.map((style) => style.styleCode)).toEqual(["SMS-1", "SMS-2"]);
    expect(yanse?.styles[0]?.colors.map((color) => color.qtyText)).toEqual(["不下", "20"]);
    expect(yanse?.styles[0]?.po).toBe("PO100094");
    expect(yanse?.styles[0]?.button).toBe("金色");
    expect(yanse?.styles[0]?.colors.map((color) => color.metalBadge)).toEqual(["金色", "银色"]);
    expect(products.sales.find((style) => style.styleCode === "SMS-1")).toBeUndefined();
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(draftsBefore);
  });

  it("跟单可以单独开成生产订单，不下和不建档的款不算，也不采购", async () => {
    const draftsBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const created = await createFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "follow-open-sheet",
      kind: "bulk",
      title: "开单演示",
      factoryName: "云杉服装工厂",
      seasonCode: "SS27",
    });
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    await saveFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: created.sheetId,
      expectedUpdatedAt: sheet.updatedAt.toISOString(),
      idempotencyKey: "follow-open-save",
      factoryName: "云杉服装工厂",
      styles: [
        {
          styleCode: "ST-26003",
          styleName: "亚麻衬衫",
          bulk: { colors: [{ guestColor: "灰", qtyText: "不下" }, { guestColor: "海军蓝", qtyText: "100" }] },
        },
        {
          styleCode: "SMS-9",
          styleName: "未建档",
          bulk: { colors: [{ guestColor: "蓝", qtyText: "8" }] },
        },
      ],
    });
    await expect(
      openFollowAsOrder({
        organizationId: IDS.orgDemo,
        userId: IDS.userFactory,
        role: "factory",
        sheetId: created.sheetId,
        customerId: IDS.customerNorthshore,
        idempotencyKey: "follow-open-deny",
      }),
    ).rejects.toThrow(/不能把跟单开成/);
    const opened = await openFollowAsOrder({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: created.sheetId,
      customerId: IDS.customerNorthshore,
      idempotencyKey: "follow-open-ok01",
    });
    expect(opened.reused).toBe(false);
    expect(opened.skipped).toContain("SMS-9还没建档");
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: opened.orderId },
      include: { lines: { include: { colors: true } } },
    });
    expect(order.productionReadiness).toBe("blocked_incomplete_spec");
    expect(order.factoryId).toBe(IDS.factoryYunshan);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]?.totalQuantity).toBe(100);
    expect(order.lines[0]?.colors.map((color) => color.colorName)).toEqual(["海军蓝"]);
    const linked = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    expect(linked.salesOrderId).toBe(order.id);
    const again = await openFollowAsOrder({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: created.sheetId,
      customerId: IDS.customerNorthshore,
      idempotencyKey: "follow-open-ok02",
    });
    expect(again.reused).toBe(true);
    expect(again.orderId).toBe(order.id);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(draftsBefore);
  });

  it("同一款号能从销售样点到大货，试卖件数不抄进大货", async () => {
    const draftsBefore = await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } });
    const ordersBefore = await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } });
    const sales = await createFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "link-sales-0001",
      kind: "sales_sample",
      title: "试卖",
      seasonCode: "SS27",
    });
    const bulk = await createFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      idempotencyKey: "link-bulk-00001",
      kind: "bulk",
      title: "真做",
      factoryName: "云杉服装工厂",
      seasonCode: "SS27",
    });
    const salesSheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: sales.sheetId } });
    const bulkSheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: bulk.sheetId } });
    await saveFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: sales.sheetId,
      expectedUpdatedAt: salesSheet.updatedAt.toISOString(),
      idempotencyKey: "link-save-sales1",
      seasonCode: "SS27",
      styles: [{ styleCode: "ST-LINK", styleName: "背心", salesSample: { salesSample: "24", colors: "海军蓝" } }],
    });
    await saveFollowSheet({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      sheetId: bulk.sheetId,
      expectedUpdatedAt: bulkSheet.updatedAt.toISOString(),
      idempotencyKey: "link-save-bulk01",
      seasonCode: "SS27",
      factoryName: "云杉服装工厂",
      styles: [{ styleCode: "ST-LINK", styleName: "背心", bulk: { colors: [{ guestColor: "海军蓝", qtyText: "580" }] } }],
    });
    const products = await listFollowProducts(IDS.orgDemo, { role: "manager", factoryId: null });
    const sample = products.sales.find((style) => style.styleCode === "ST-LINK");
    const made = products.bulk.flatMap((group) => group.styles).find((style) => style.styleCode === "ST-LINK");
    expect(sample?.salesSampleQty).toBe("24");
    expect(sample?.others).toEqual([
      { href: `/orders/follow/${bulk.sheetId}`, label: "大货 · 云杉服装工厂 · 真做" },
    ]);
    expect(made?.colors.map((color) => color.qtyText)).toEqual(["580"]);
    expect(made?.salesSampleQty).toBe("");
    expect(made?.others).toEqual([{ href: `/orders/follow/${sales.sheetId}`, label: "销售样 · 试卖" }]);
    expect(await prisma.salesOrder.count({ where: { organizationId: IDS.orgDemo } })).toBe(ordersBefore);
    expect(await prisma.purchaseDraft.count({ where: { organizationId: IDS.orgDemo } })).toBe(draftsBefore);
  });
});
