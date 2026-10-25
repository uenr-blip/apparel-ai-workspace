import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./helpers";
import { simulateFreshOrderFinanceChain } from "./scenarios/fresh-order-finance-chain";

describe("隔离库新输入整链", () => {
  beforeEach(resetDatabase);

  it("新建主档与订单后核对收付金额，验证未投产不能出运，不改日常业务库", async () => {
    const report = await simulateFreshOrderFinanceChain();
    expect(report.mode).toBe("ISOLATED_FRESH_CHAIN");
    expect(report.styleCode).toBe("ST-CHAIN-01");
    expect(report.orderId).not.toBe("order-demo-005");
    expect(report.trialBalanced).toBe(true);
    expect(report.rows.every((row) => row.difference === "0.00")).toBe(true);
    expect(report.blocked).toHaveLength(4);
    expect(report.checks.length).toBeGreaterThanOrEqual(16);
  });
});
