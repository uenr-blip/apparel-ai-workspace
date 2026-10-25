import { describe, expect, it } from "vitest";
import { bulkDeskNext } from "@/server/domain/bulk-desk-next";

const checks = {
  spec: (passed: boolean, evidence: string) => ({ id: "spec", passed, evidence }),
  color: (passed: boolean, evidence: string) => ({ id: "color", passed, evidence }),
  material: (passed: boolean, evidence: string) => ({ id: "factory_material", passed, evidence }),
};

const readyChecks = [
  checks.spec(true, "资料已批准，色尺已齐"),
  checks.color(true, "各色最新一轮已批准"),
  checks.material(true, "可开裁"),
];

function next(overrides: Partial<Parameters<typeof bulkDeskNext>[0]> = {}) {
  return bulkDeskNext({
    orderId: "order-demo-002",
    orderNo: "DEMO-ORD-002",
    alreadyReleased: false,
    alreadyDone: false,
    checks: readyChecks,
    cutBlockers: [],
    material: null,
    purchase: null,
    ...overrides,
  });
}

describe("大货下一件", () => {
  it("资料没批时，先让业务员或经理批本单资料", () => {
    const step = next({
      checks: [checks.spec(false, "资料未批准"), checks.color(false, "分色未齐"), checks.material(false, "未到料")],
    });
    expect(step.who).toBe("业务员或经理");
    expect(step.action).toContain("先把本单资料批了");
    expect(step.availability).toBe("now");
    expect(step.href).toBe("/orders/order-demo-002#prep");
  });

  it("资料齐了分色未齐时，工厂不能批分色", () => {
    const step = next({
      checks: [checks.spec(true, "资料已批准，色尺已齐"), checks.color(false, "分色未齐"), checks.material(false, "未到料")],
    });
    expect(step.action).toContain("工厂不能批分色");
    expect(step.href).toBe("/orders/order-demo-002#color-confirm");
  });

  it("未到料且采购草稿还在时，写明正式下单还没开", () => {
    const step = next({
      checks: [...readyChecks.slice(0, 2), checks.material(false, "未到料")],
      cutBlockers: ["未到料"],
      material: { materialCode: "MAT-001", unit: "米", gross: "1545", companyOnHand: "170", atFactory: "0" },
      purchase: { optionCode: "B", qty: "1350", status: "draft" },
    });
    expect(step.who).toBe("仓管");
    expect(step.availability).toBe("unbuilt");
    expect(step.availabilityLabel).toBe("这一步还没开");
    expect(step.action).toContain("毛需求 1545 米");
    expect(step.action).toContain("公司在手 170 米");
    expect(step.action).toContain("厂里 0 米");
    expect(step.action).toContain("在途没收不能当现货");
    expect(step.action).toContain("方案 B 采购草稿 1350 米");
    expect(step.action).toContain("正式下单这一步还没开");
    expect(step.action).not.toContain("已采购");
    expect(step.action).not.toContain("已付款");
  });

  it("还有在途时，仓管先去收料，正式下单仍没开", () => {
    const step = next({
      checks: [...readyChecks.slice(0, 2), checks.material(false, "未到料")],
      cutBlockers: ["未到料"],
      material: { materialCode: "MAT-001", unit: "m", gross: "1545", companyOnHand: "170", atFactory: "0" },
      purchase: { optionCode: "B", qty: "1350", status: "draft" },
      inboundOpen: "200",
    });
    expect(step.who).toBe("仓管");
    expect(step.availability).toBe("now");
    expect(step.href).toBe("/resources/material-ledger");
    expect(step.action).toContain("在途 200 m 还没收");
    expect(step.action).toContain("还差的米数要等正式下单，这一步还没开");
  });

  it("在途收完仍不够开裁时，差额停在采购草稿", () => {
    const step = next({
      checks: [...readyChecks.slice(0, 2), checks.material(false, "未到料")],
      cutBlockers: ["未到料"],
      material: { materialCode: "MAT-001", unit: "m", gross: "1545", companyOnHand: "370", atFactory: "120" },
      purchase: { optionCode: "B", qty: "1350", status: "draft" },
      inboundOpen: "0",
      receivedQty: "200",
    });
    expect(step.availability).toBe("unbuilt");
    expect(step.action).toContain("在途已收 200 m");
    expect(step.action).toContain("厂里 120 m");
    expect(step.action).toContain("公司在手 370 m");
    expect(step.action).toContain("方案 B 采购草稿 1350 m");
    expect(step.action).not.toContain("已采购");
  });

  it("采购单已下达时，下一件是等布到了再收", () => {
    const step = next({
      checks: [...readyChecks.slice(0, 2), checks.material(false, "未到料")],
      cutBlockers: ["未到料"],
      material: { materialCode: "MAT-001", unit: "m", gross: "1545", companyOnHand: "370", atFactory: "120" },
      purchase: { optionCode: "B", qty: "1350", status: "issued" },
      inboundOpen: "0",
      receivedQty: "200",
    });
    expect(step.who).toBe("仓管");
    expect(step.availability).toBe("waiting");
    expect(step.availabilityLabel).toBe("等布到了再收");
    expect(step.href).toBe("/resources/material-ledger");
    expect(step.action).toContain("已下达采购 1350 m");
    expect(step.action).toContain("采购单不是到料，也不是付款");
    expect(step.action).toContain("在途已收 200 m");
  });

  it("公司有料没发到厂时，仓管现在可以调拨", () => {
    const step = next({
      checks: [...readyChecks.slice(0, 2), checks.material(false, "未调到厂")],
      cutBlockers: ["未调到厂"],
      material: { materialCode: "MAT-001", unit: "米", gross: "100", companyOnHand: "100", atFactory: "0" },
    });
    expect(step.who).toBe("仓管");
    expect(step.availability).toBe("now");
    expect(step.action).toContain("调拨不是领用");
    expect(step.href).toBe("/resources?view=today");
  });

  it("门槛齐了由经理批准投产", () => {
    const step = next();
    expect(step.who).toBe("经理");
    expect(step.availability).toBe("now");
    expect(step.action).toContain("可以批准投产");
    expect(step.href).toBeNull();
  });

  it("已投产去进度台记产量，付款仍没开", () => {
    const step = next({ alreadyReleased: true });
    expect(step.who).toContain("工厂记产量");
    expect(step.href).toBe("/delivery");
    expect(step.action).toContain("付款这一步还没开");
    expect(step.action).toContain("待称重");
  });

  it("已出运不能再批准投产", () => {
    const step = next({ alreadyDone: true, alreadyReleased: false });
    expect(step.action).toContain("不能再批准投产");
    expect(step.href).toContain("/finance?tab=reconciliation");
  });
});
