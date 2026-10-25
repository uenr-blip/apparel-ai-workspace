import { describe, it, expect } from "vitest";
import { parseMoney, formatMoney, convertMoney, checkDate, csvCell } from "@/lib/trade-money";
describe("外贸金额精度", () => {
  it("按币种严格保存整数，不接受浮点近似或超精度", () => {
    expect(parseMoney("0.10", "USD") + parseMoney("0.20", "USD")).toBe(BigInt(30));
    expect(formatMoney(BigInt(1234), "KWD")).toBe("1.234");
    expect(parseMoney("100", "JPY")).toBe(BigInt(100));
    for (const value of ["1.001", "Infinity", "1e6", "-1", "", "10000000000000"]) expect(() => parseMoney(value, "USD")).toThrow();
    expect(() => parseMoney("1.1", "JPY")).toThrow();
  });
  it("明确转换方向和金额舍入", () => {
    expect(convertMoney(BigInt(10000), "USD", "CNY", "7.12345678")).toBe(BigInt(71235));
    expect(convertMoney(BigInt(10000), "USD", "JPY", "150.5")).toBe(BigInt(15050));
    expect(() => convertMoney(BigInt(100), "USD", "CNY", "0")).toThrow();
  });
  it("拒绝伪日期并防止CSV公式执行", () => {
    expect(checkDate("2026-09-20")).toBe("2026-09-20");
    expect(() => checkDate("2026-02-30")).toThrow();
    expect(csvCell("=HYPERLINK(\"x\")")).toContain("'=");
    expect(csvCell("\t+1")).toContain("'");
  });
});
