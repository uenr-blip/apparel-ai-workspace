import { describe, it, expect } from "vitest";
import { comparisonAmount, expectedSourceAmount } from "@/lib/reconciliation-money";
describe("金额核对独立复算", () => {
  it("按原币精度折算，负数、零和聚合金额不经过浮点数", () => {
    expect(comparisonAmount(BigInt(-12345), "USD", "CNY", "7.10")).toBe(BigInt(-87650));
    expect(comparisonAmount(BigInt(0), "JPY", "CNY", "0.05")).toBe(BigInt(0));
    expect(comparisonAmount(BigInt(1001), "KWD", "CNY", "23")).toBe(BigInt(2302));
    expect(comparisonAmount(BigInt("3000000000000000"), "CNY", "CNY", "1")).toBe(BigInt("3000000000000000"));
  });
  it("原单、负扣补、收付手续费按来源重新推导借贷总额", () => {
    expect(expectedSourceAmount({type:"bill",currency:"USD",originalAmount:"10000"}, "CNY", "7", "")).toBe(BigInt(70000));
    expect(expectedSourceAmount({type:"adjustment",currency:"CNY",originalAmount:"10000",adjustment:{amount:"-2000"}}, "CNY", "1", "")).toBe(BigInt(2000));
    expect(expectedSourceAmount({type:"cash",currency:"CNY",amount:"10000",fee:"200",direction:"pay"}, "CNY", "1", "")).toBe(BigInt(10200));
    expect(expectedSourceAmount({type:"refund",currency:"CNY",amount:"10000",fee:"200",direction:"receive"}, "CNY", "1", "")).toBe(BigInt(10000));
  });
  it("汇兑差额独立复算，缺入账汇率或账面依据时拒绝猜数", () => {
    expect(expectedSourceAmount({type:"fx",toCurrency:"CNY",toMinor:"350000",feeMinor:"2000"}, "CNY", "1", "3550")).toBe(BigInt(355000));
    expect(() => expectedSourceAmount({type:"bill",currency:"USD",originalAmount:"100"}, "CNY", "", "")).toThrow(/汇率/);
    expect(() => expectedSourceAmount({type:"fx",toCurrency:"CNY",toMinor:"350000",feeMinor:"2000"}, "CNY", "", "")).toThrow();
  });
});
