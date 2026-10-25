import { beforeEach, describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { getFinanceHome } from "@/server/services/finance-home";
import { runTradeCommand } from "@/server/services/trade-write";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";
const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const staff = { ...manager, userId: IDS.userSales, role: "salesperson" };
let n = 0;
const trade = (p: Record<string, unknown>) => runTradeCommand(manager, { ...p, idempotencyKey: `home-${++n}` });
async function grant(action: string, enabled = true) { return setUserPermission({ organizationId: manager.organizationId, managerId: manager.userId, targetUserId: staff.userId, action, enabled }); }
describe("财务办事首页", () => {
  beforeEach(resetDatabase);
  it("没有账套也能读取真实业务待办和分币种余额", async () => {
    await trade({ action: "save_contract", orderId: "order-demo-005", currency: "USD", amount: "500", tradeMode: "unknown", incoterm: "", terms: "测试合同", expectedVersion: 0 });
    await trade({ action: "create_bill", orderId: "order-demo-005", direction: "receivable", title: "订金待核对", category: "deposit", currency: "USD", amount: "100", dueDate: "2026-09-20", basis: "合同" });
    const ap = await trade({ action: "create_bill", orderId: "order-demo-005", direction: "payable", partyId: IDS.supplierQinghe, title: "加工结算", category: "processing", currency: "CNY", amount: "200", dueDate: "2026-09-20", basis: "依据" });
    await trade({ action: "confirm_bill", id: ap.id, expectedVersion: 1 });
    await trade({ action: "record_cash", direction: "receive", partyId: "customer-qinglan", currency: "USD", amount: "500", fee: "0", bankAccount: "演示", bankReference: "HOME-500", occurredOn: "2026-09-18", basis: "到账" });
    const data = await getFinanceHome(manager);
    expect(data.trade?.receivableDrafts).toBe(1); expect(data.unallocatedCashCount).toBe(1);
    expect(data.trade?.currencies.find(c => c.currency === "CNY")?.payable).toBe("200.00");
    expect(data.trade?.currencies.find(c => c.currency === "USD")?.unallocatedReceive).toBe("500.00");
    expect(data.ledger?.bookCount).toBe(0);
  });
  it("仅总账用户不读取或披露业务余额，撤权和伪造身份被拒绝", async () => {
    await grant("ledger_view");
    await runLedgerCommand(manager, { action: "create_book", name: "首页账簿", baseCurrency: "CNY", startMonth: "2026-09", idempotencyKey: "home-book" });
    const data = await getFinanceHome(staff);
    expect(data.trade).toBeNull(); expect(data.legacy).toBeNull(); expect(data.unallocatedCashCount).toBeNull();
    expect(data.ledger?.bookCount).toBe(1);
    await grant("ledger_view", false); await expect(getFinanceHome(staff)).rejects.toThrow(/无权/);
    await expect(getFinanceHome({ ...staff, role: "manager" })).rejects.toThrow(/无权/);
    await expect(getFinanceHome({ ...manager, organizationId: "other-org" })).rejects.toThrow(/无权/);
  });
  it("会计待复核数排除本人制单，总数不被首页六个账簿截断", async () => {
    await grant("ledger_view"); await grant("ledger_review");
    for (let i = 0; i < 7; i++) {
      const b = await runLedgerCommand(manager, { action: "create_book", name: `账簿${i}`, baseCurrency: "CNY", startMonth: "2026-09", idempotencyKey: `home-book-${i}` });
      const accounts = await prisma.gLAccount.findMany({ where: { bookId: b.id } });
      await runLedgerCommand(manager, { action: "save_journal", bookId: b.id, date: "2026-09-20", summary: "待核对", basis: "虚构", expectedVersion: 0, lines: [{ accountId: accounts[0].id, debit: "1", credit: "0", note: "" }, { accountId: accounts[1].id, debit: "0", credit: "1", note: "" }], idempotencyKey: `home-draft-${i}` });
    }
    expect((await getFinanceHome(manager)).ledger?.reviewable).toBe(0);
    const data = await getFinanceHome(staff);
    expect(data.ledger?.reviewable).toBe(7); expect(data.ledger?.bookCount).toBe(7); expect(data.ledger?.books).toHaveLength(6);
  });
});
