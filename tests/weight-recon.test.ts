import { beforeEach, describe, expect, it } from "vitest";
import { ACTION_TYPES, IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { computeReconDraft } from "@/server/domain/recon";
import { getProductionBoard } from "@/server/services/production-board";
import { recordCartonWeight } from "@/server/services/packing";
import { generateFactoryReconDraft } from "@/server/services/recon";
import { resetDatabase } from "./helpers";

describe("E04/E05 领域规则", () => {
  it("没有净重毛重不能标实测；只有一侧重量是估算", async () => {
    const { weightStatusFor } = await import("@/server/domain/packing");
    expect(weightStatusFor({ claimed: "measured" })).toBe("pending");
    expect(weightStatusFor({ netWeight: "12.50", claimed: "measured" })).toBe("pending");
    expect(weightStatusFor({ netWeight: "12.50", claimed: "estimated" })).toBe("estimated");
  });

  it("对账金额按合格出运件数×单价；无基准不能编数字", () => {
    expect(
      computeReconDraft({ shippedQty: 980, unitPriceYuan: "12.50", basisNote: "合格出运件数 × 12.50 元/件。不是付款。" }),
    ).toMatchObject({ status: "draft", amountYuan: "12250.00", paid: false });
    expect(computeReconDraft({ shippedQty: 980, unitPriceYuan: null, basisNote: "待核实" })).toMatchObject({
      status: "needs_basis",
      amountYuan: null,
      paid: false,
    });
  });
});

describe("E04 称重录入与 E05 对账草稿", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("录入实测必须有净重和毛重；缺重量不能冒充实测；估算与实测能区分", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    const carton = row?.packing.plans[0]?.cartons.find((item) => item.cartonNo === "C-980-1");
    expect(carton?.weightStatus).toBe("pending");
    expect(carton?.netWeight).toBeNull();
    expect(carton?.id).toBe("pack-carton-005-1");

    await expect(
      recordCartonWeight({
        organizationId: IDS.orgDemo,
        userId: IDS.userManager,
        role: "manager",
        factoryId: null,
        cartonId: "pack-carton-005-1",
        netWeight: "",
        grossWeight: "",
        claimed: "measured",
      }),
    ).rejects.toThrow("净重和毛重都录入才能标实测");

    const estimated = await recordCartonWeight({
      organizationId: IDS.orgDemo,
      userId: IDS.userFactory,
      role: "factory",
      factoryId: IDS.factoryYunshan,
      cartonId: "pack-carton-005-1",
      netWeight: "12.50",
      grossWeight: "",
      claimed: "estimated",
    });
    expect(estimated.carton.weightStatus).toBe("estimated");
    expect(estimated.carton.netWeight).toBe("12.50");
    expect(estimated.carton.grossWeight).toBeNull();

    const measured = await recordCartonWeight({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      cartonId: "pack-carton-005-1",
      netWeight: "12.50",
      grossWeight: "13.10",
      claimed: "measured",
    });
    expect(measured.carton.weightStatus).toBe("measured");
    expect(measured.carton.grossWeight).toBe("13.10");

    const after = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const updated = after.rows
      .find((item) => item.orderNo === "DEMO-ORD-005")
      ?.packing.plans[0]?.cartons.find((item) => item.cartonNo === "C-980-1");
    expect(updated?.weightStatus).toBe("measured");
    expect(JSON.stringify(after)).not.toContain("付款成功");

    await expect(
      recordCartonWeight({
        organizationId: IDS.orgIso,
        userId: IDS.userIso,
        role: "salesperson",
        factoryId: null,
        cartonId: "pack-carton-005-1",
        netWeight: "1",
        grossWeight: "1",
        claimed: "measured",
      }),
    ).rejects.toThrow(/无权|不存在/);
  });

  it("有基准时按合格出运件数生成对账草稿；发运不会自动付款；无基准则待核实", async () => {
    const board = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    const row = board.rows.find((item) => item.orderNo === "DEMO-ORD-005");
    expect(row?.recon).toBeNull();
    expect(board.facts.join(" ")).toContain("对账草稿不是付款");
    expect(ACTION_TYPES).not.toHaveProperty("payFactory");
    expect(ACTION_TYPES).not.toHaveProperty("payRecon");

    const created = await generateFactoryReconDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      idempotencyKey: "recon-005",
    });
    expect(created.reused).toBe(false);
    expect(created.draft).toMatchObject({
      status: "draft",
      shippedQty: 980,
      unitPriceYuan: "12.50",
      amountYuan: "12250.00",
      paid: false,
    });
    expect(created.draft.basisNote).toContain("合格出运件数");
    expect(created.draft.basisNote).toContain("不是付款");

    const again = await generateFactoryReconDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      idempotencyKey: "recon-005",
    });
    expect(again.reused).toBe(true);
    expect(again.draft.id).toBe(created.draft.id);
    expect(again.draft.paid).toBe(false);

    const listed = await getProductionBoard(IDS.orgDemo, { role: "manager", factoryId: null });
    expect(listed.rows.find((item) => item.orderNo === "DEMO-ORD-005")?.recon).toMatchObject({
      amountYuan: "12250.00",
      paid: false,
      status: "draft",
    });

    await expect(
      generateFactoryReconDraft({
        organizationId: IDS.orgDemo,
        userId: IDS.userSales,
        role: "salesperson",
        factoryId: null,
        orderId: "order-demo-005",
        idempotencyKey: "sales-recon",
      }),
    ).rejects.toThrow("无权生成对账草稿");

    await prisma.organizationPolicy.update({
      where: { id: "policy-recon-basis" },
      data: { enabled: false },
    });
    await prisma.factoryReconDraft.deleteMany({ where: { orderId: "order-demo-005" } });
    const blocked = await generateFactoryReconDraft({
      organizationId: IDS.orgDemo,
      userId: IDS.userManager,
      role: "manager",
      factoryId: null,
      orderId: "order-demo-005",
      idempotencyKey: "recon-no-basis",
    });
    expect(blocked.draft.status).toBe("needs_basis");
    expect(blocked.draft.amountYuan).toBeNull();
    expect(blocked.draft.paid).toBe(false);
    expect(blocked.draft.basisNote).toContain("待核实");
  });
});
