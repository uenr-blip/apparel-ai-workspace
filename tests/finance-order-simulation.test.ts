import { writeFileSync } from "node:fs";
import { beforeEach, describe, it, expect } from "vitest";
import { resetDatabase } from "./helpers";
import { simulateFinanceOrder } from "./scenarios/finance-order-simulation";
describe("整单模拟业务验收", () => {
  beforeEach(resetDatabase);
  it("实物、加工出运、外贸收付、退款结汇、金额对账和冲销关账按同一案例核验", async () => {
    const report = await simulateFinanceOrder();
    expect(report.trialBalanced).toBe(true);
    expect(report.rows.every(r => r.difference === "0.00")).toBe(true);
    expect(report.rows.find(r => r.role === "funds")?.status).toBe("manual_review");
    expect(report.gaps.unvalued + report.gaps.unassigned + report.gaps.pendingSources).toBe(0);
    if (process.env.MONEY_SCENARIO_REPORT_PATH) writeFileSync(process.env.MONEY_SCENARIO_REPORT_PATH, JSON.stringify(report, null, 2));
  });
});
