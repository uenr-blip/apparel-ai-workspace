import { describe, expect, it } from "vitest";
import { financeNavigation } from "@/lib/finance-navigation";
const all = { trade: true, ledger: true, legacy: true };
describe("财务导航与旧链接", () => {
  it("经理只有五个主工作区，默认进入办事首页", () => {
    const nav = financeNavigation(all, {});
    expect(nav.groups.map(g => g.label)).toEqual(["财务工作台", "业务对账", "收付与结汇", "会计账务", "订单成本"]);
    expect(nav.section).toBe("home"); expect(nav.tab).toBe("overview"); expect(nav.denied).toBe(false);
  });
  it("旧链接保留原业务和筛选，资金调整按具体视图归入收付区", () => {
    for (const tab of ["receivables", "payables", "reconciliation", "documents", "vouchers"]) expect(financeNavigation(all, { tab }).section).toBe("business");
    for (const tab of ["cash", "treasury"]) expect(financeNavigation(all, { tab }).section).toBe("funds");
    expect(financeNavigation(all, { tab: "treasury", view: "fx" }).subKey).toBe("fx");
    const params = { tab: "bridge", bookId: "book-1", orderId: "order-1", q: "待核对" };
    expect(financeNavigation(all, params).tab).toBe("bridge"); expect(params.q).toBe("待核对");
    expect(financeNavigation(all, { tab: "ledger" }).section).toBe("accounting");
    expect(financeNavigation(all, { tab: "costs" }).section).toBe("costs");
  });
  it("新业务对账入口默认按款项查，旧应收入口的订单视图仍保留", () => {
    expect(financeNavigation(all, { section: "business" }).view).toBe("bills");
    expect(financeNavigation(all, { tab: "receivables" }).view).toBeUndefined();
    expect(financeNavigation(all, { tab: "cash", section: "accounting" }).section).toBe("funds");
  });
  it("无总账权限不显示会计区，手写URL也不回退成有权页面", () => {
    const caps = { trade: true, ledger: false, legacy: false };
    expect(financeNavigation(caps, {}).groups.map(g => g.key)).toEqual(["home", "business", "funds", "costs"]);
    expect(financeNavigation(caps, { tab: "ledger" }).denied).toBe(true);
    expect(financeNavigation(caps, { section: "accounting" }).denied).toBe(true);
  });
  it("仅会计权限默认进入会计账簿，旧加工权限仍能找到加工和材料依据", () => {
    const accountant = financeNavigation({ trade: false, ledger: true, legacy: false }, { section: "accounting" });
    expect(accountant.tab).toBe("ledger");
    expect(accountant.groups.map(g => g.key)).toEqual(["home", "accounting"]);
    expect(accountant.secondary.map(g => g.key)).not.toContain("bridge");
    expect(financeNavigation({ trade: false, ledger: false, legacy: true }, { section: "business" }).tab).toBe("reconciliation");
    expect(financeNavigation({ trade: false, ledger: false, legacy: true }, { tab: "vouchers" }).denied).toBe(false);
    expect(financeNavigation({ trade: false, ledger: false, legacy: false }, {}).denied).toBe(true);
  });
});
