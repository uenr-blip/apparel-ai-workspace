import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  grossRequirementMeters,
  netRequirementMeters,
  purchaseLineAmountMinor,
  purchaseLineAmountYuan,
  suggestedPurchaseMeters,
} from "@/server/domain/procurement";

const fixture = JSON.parse(readFileSync("fixtures/expected-cases.json", "utf8")) as {
  procurementAllowanceCase: {
    quantityPieces: number;
    consumptionMetersPerPiece: string;
    allowanceRate: string;
    consumptionIncludesAllowance: boolean;
    eligibleFreeStockMeters: string;
    eligibleTimelyUnallocatedInboundMeters: string;
    minimumOrderMeters: string;
    orderMultipleMeters: string;
    unitPriceCNYPerMeter: string;
    expectedGrossRequirementMeters: string;
    expectedNetRequirementMeters: string;
    expectedSuggestedPurchaseMeters: string;
    expectedPurchaseLineAmountCNY: string;
    expectedPurchaseLineAmountMinorCNY: number;
  };
};

describe("采购加成净需求口径", () => {
  it("未含加成时毛需求 1545、净需求 1225、建议 1230、金额 24600.00", () => {
    const c = fixture.procurementAllowanceCase;
    const gross = grossRequirementMeters({
      quantityPieces: c.quantityPieces,
      consumption: c.consumptionMetersPerPiece,
      allowanceRate: c.allowanceRate,
      includesAllowance: c.consumptionIncludesAllowance,
    });
    const net = netRequirementMeters({
      gross,
      eligibleFreeStock: c.eligibleFreeStockMeters,
      eligibleTimelyInbound: c.eligibleTimelyUnallocatedInboundMeters,
    });
    const suggested = suggestedPurchaseMeters({
      net,
      moq: c.minimumOrderMeters,
      multiple: c.orderMultipleMeters,
    });
    expect(gross).toBe(c.expectedGrossRequirementMeters);
    expect(net).toBe(c.expectedNetRequirementMeters);
    expect(suggested).toBe(c.expectedSuggestedPurchaseMeters);
    expect(purchaseLineAmountYuan(suggested, c.unitPriceCNYPerMeter)).toBe(c.expectedPurchaseLineAmountCNY);
    expect(purchaseLineAmountMinor(suggested, c.unitPriceCNYPerMeter)).toBe(c.expectedPurchaseLineAmountMinorCNY);
  });

  it("已含加成的 1.545 不再乘 1.03", () => {
    const gross = grossRequirementMeters({
      quantityPieces: 1000,
      consumption: "1.545",
      allowanceRate: "0.03",
      includesAllowance: true,
    });
    expect(gross).toBe("1545");
    expect(gross).not.toBe("1591");
  });

  it("净需求为 0 时采购为 0", () => {
    expect(suggestedPurchaseMeters({ net: "0", moq: "300", multiple: "10" })).toBe("0");
  });
});
