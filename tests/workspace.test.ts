import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ingestText, parseSource } from "@/server/services/intake";
import { approveProposal } from "@/server/services/execution";
import {
  collapseDeskDecisions,
  getWorkspaceSnapshot,
  groupBlockingTasks,
  summarizeDecision,
  summarizeProcessed,
  WORKSPACE_PREVIEW_LIMIT,
} from "@/server/services/workspace";
import { resetDatabase } from "./helpers";

const developmentText = readFileSync("fixtures/03-material-development.txt", "utf8");

async function addBlock(orderId: string, kind: string, title: string) {
  await prisma.taskItem.create({
    data: {
      id: createId(),
      organizationId: IDS.orgDemo,
      title,
      kind,
      status: "open",
      blocking: true,
      relatedOrderId: orderId,
      relatedStyleId: IDS.styleSt26018,
    },
  });
}

describe("工作台阻塞预览", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("同一张订单的多条阻塞收成一行，首页不超过 8 张订单", async () => {
    await addBlock("order-demo-001", "missing_size_breakdown", "待补尺码");
    await addBlock("order-demo-001", "missing_rib_spec", "待确认罗纹");
    await addBlock("order-demo-001", "missing_delivery_year", "待确认交期年份");
    for (const orderId of ["order-demo-003", "order-demo-005", "order-demo-006", "order-demo-007", "order-demo-008"]) {
      await addBlock(orderId, "missing_size_breakdown", "待补尺码");
    }
    await prisma.salesOrder.create({
      data: {
        id: "order-extra-block",
        organizationId: IDS.orgDemo,
        orderNo: "DEMO-ORD-099",
        customerId: IDS.customerNorthshore,
        status: "confirmed",
        productionReadiness: "blocked_incomplete_spec",
        lines: {
          create: {
            id: "line-extra-block",
            styleId: IDS.styleSt26018,
            totalQuantity: 10,
            colors: { create: [{ id: "color-extra-block", colorName: "本色", quantity: 10 }] },
          },
        },
      },
    });
    await addBlock("order-extra-block", "missing_rib_spec", "待确认罗纹");

    const data = await getWorkspaceSnapshot(IDS.orgDemo);
    const grouped001 = data.blockGroups.find((row) => row.orderNo === "DEMO-ORD-001");
    expect(grouped001?.kinds).toEqual(
      expect.arrayContaining(["missing_size_breakdown", "missing_rib_spec", "missing_delivery_year"]),
    );
    expect(data.blockGroups.filter((row) => row.orderNo === "DEMO-ORD-001")).toHaveLength(1);
    expect(data.blockOrderTotal).toBeGreaterThan(WORKSPACE_PREVIEW_LIMIT);
    expect(data.blockGroups).toHaveLength(WORKSPACE_PREVIEW_LIMIT);
    expect(data.blockTotal).toBeGreaterThan(data.blockGroups.length);
  });
});

describe("工作台相同事项收成一行", () => {
  it("未挂单的相同缺项收成一行，订单缺项仍单独留下", () => {
    const groups = groupBlockingTasks([
      {
        id: "yarn-1",
        kind: "material_test_pending",
        title: "完成纱线手感与缩水试验",
        relatedOrderId: null,
        order: null,
        style: null,
      },
      {
        id: "yarn-2",
        kind: "material_test_pending",
        title: "完成纱线手感与缩水试验",
        relatedOrderId: null,
        order: null,
        style: null,
      },
      {
        id: "eta-1",
        kind: "late_material_risk",
        title: "MAT-001 在途日期需核验",
        relatedOrderId: "order-demo-002",
        order: { id: "order-demo-002", orderNo: "DEMO-ORD-002" },
        style: null,
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.titles).toEqual(["完成纱线手感与缩水试验"]);
    expect(groups[0]?.repeatCount).toBe(2);
    expect(groups[0]?.href).toBe("/styles?tab=projects");
    expect(groups[1]?.orderNo).toBe("DEMO-ORD-002");
    expect(groups[1]?.repeatCount).toBe(1);
    expect(groups[1]?.href).toBe("/orders/order-demo-002");
  });

  it("标题和说明相同的待批收成一行，并指向待批准列表", () => {
    const draft = {
      actionType: "create_order_draft",
      payloadJson: JSON.stringify({ customerCodeHint: "北岸服饰" }),
      evidenceJson: JSON.stringify({
        intent: "reorder",
        customerName: { value: "北岸服饰" },
        styleCode: { value: "ST-26018" },
      }),
    };
    const rows = collapseDeskDecisions([
      summarizeDecision({ id: "newest", sourceDocumentId: "src-new", ...draft }),
      summarizeDecision({ id: "older", sourceDocumentId: "src-old", ...draft }),
      summarizeDecision({
        id: "adopt",
        actionType: "adopt_purchase_option",
        sourceDocumentId: "src-adopt",
        payloadJson: "{}",
        evidenceJson: "{}",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.title).toBe("创建订单草稿");
    expect(rows[0]?.detail).toContain("北岸服饰");
    expect(rows[0]?.detail).toContain("共 2 份");
    expect(rows[0]?.href).toBe("/decisions?status=preview");
    expect(rows[1]?.href).toBe("/decisions/adopt");
    expect(rows[1]?.detail).not.toContain("共 ");
  });

});

describe("工作台四块文案", () => {
  it("待决策写清动作、客户和款号，不写空的审核来源提案", () => {
    const row = summarizeDecision({
      id: "p1",
      actionType: "create_order_draft",
      sourceDocumentId: "src-1",
      payloadJson: JSON.stringify({ customerCodeHint: "北岸服饰", selectedStyleId: "style-st-26018" }),
      evidenceJson: JSON.stringify({
        intent: "reorder",
        customerName: { value: "北岸服饰" },
        styleCode: { value: "ST-26018" },
      }),
    });
    expect(row.title).toBe("创建订单草稿");
    expect(row.detail).toContain("北岸服饰");
    expect(row.detail).toContain("ST-26018");
    expect(row.detail).toContain("翻单");
    expect(row.href).toBe("/decisions/p1");
    expect(row.title).not.toContain("审核来源提案");
  });

  it("材料开发提案标明材料先行、尚无款号", () => {
    const row = summarizeDecision({
      id: "p2",
      actionType: "create_development_project",
      sourceDocumentId: "src-2",
      payloadJson: JSON.stringify({ customerName: "北岸服饰", materials: [{ code: "YARN-DEMO-01" }] }),
      evidenceJson: JSON.stringify({
        intent: "material_dev",
        customerName: { value: "北岸服饰" },
        styleCode: { value: null },
      }),
    });
    expect(row.title).toBe("创建开发款式");
    expect(row.detail).toContain("北岸服饰");
    expect(row.detail).toMatch(/材料先行|尚无款号/);
  });

  it("已处理条目带出订单号，不把条数包装成效益", () => {
    const row = summarizeProcessed({
      id: "e1",
      actionType: "create_order_draft",
      sourceDocumentId: "src-3",
      status: "succeeded",
      resultJson: JSON.stringify({ orderNo: "DEMO-ORD-010" }),
    });
    expect(row.title).toBe("创建订单草稿");
    expect(row.detail).toContain("DEMO-ORD-010");
    expect(row.detail).toContain("已完成");
    expect(row.href).toBe("/inbox/src-3");
  });
});

describe("工作台财务入口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("没有查看者时不暴露财务入口", async () => {
    const data = await getWorkspaceSnapshot(IDS.orgDemo);
    expect(data.finance).toBeNull();
  });

  it("经理可以从工作台进入财务，工厂默认不能", async () => {
    const manager = await getWorkspaceSnapshot(IDS.orgDemo, {
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
    });
    const factory = await getWorkspaceSnapshot(IDS.orgDemo, {
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
    });
    expect(manager.finance).toEqual({ href: "/finance" });
    expect(factory.finance).toBeNull();
  });
});

describe("工作台可复用机会", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("没有进行中的匹配查询时，不把已批准款主档倾销成机会", async () => {
    const data = await getWorkspaceSnapshot(IDS.orgDemo);
    expect(data.reuse).toEqual([]);
  });

  it("进行中的材料开发给出资料匹配依据，不是识款", async () => {
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
    await approveProposal({
      organizationId: IDS.orgDemo,
      userId: IDS.userSales,
      role: "salesperson",
      proposalId: parsed.proposal!.id,
    });

    const data = await getWorkspaceSnapshot(IDS.orgDemo);
    expect(data.reuse.length).toBeGreaterThan(0);
    expect(data.reuse.every((row) => row.matchLabel === "资料匹配")).toBe(true);
    expect(data.reuse.every((row) => row.matchReasons.length > 0)).toBe(true);
    expect(data.reuse.some((row) => row.code === "ST-26018" || row.code.startsWith("YARN"))).toBe(true);
    expect(data.reuse.every((row) => row.historicalApprovalReusable === false)).toBe(true);
  });
});
