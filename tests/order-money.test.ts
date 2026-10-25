import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { evaluateOrderMoney } from "@/server/domain/order-money";
import { getOrderMoney } from "@/server/services/order-money";
import { runTradeCommand } from "@/server/services/trade-write";
import { resetDatabase } from "./helpers";

const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
let sequence = 0;
const run = (input: Record<string, unknown>) =>
  runTradeCommand(manager, { ...input, idempotencyKey: input.idempotencyKey ?? `money-${++sequence}` });

describe("本单收付", () => {
  it("只把已确认款项计入已收已付还欠，草稿不算欠", () => {
    const money = evaluateOrderMoney({
      contract: { currency: "USD", amountMinor: BigInt(100000) },
      bills: [
        {
          currency: "USD",
          direction: "receivable",
          status: "confirmed",
          totalMinor: BigInt(30000),
          allocatedMinor: BigInt(20000),
          openMinor: BigInt(10000),
        },
        {
          currency: "USD",
          direction: "receivable",
          status: "draft",
          totalMinor: BigInt(70000),
          allocatedMinor: BigInt(0),
          openMinor: BigInt(70000),
        },
        {
          currency: "CNY",
          direction: "payable",
          status: "confirmed",
          totalMinor: BigInt(8000),
          allocatedMinor: BigInt(3000),
          openMinor: BigInt(5000),
        },
      ],
    });
    expect(money.hasContract).toBe(true);
    expect(money.draftReceivableCount).toBe(1);
    expect(money.label).toContain("未结清");
    const usd = money.lines.find((row) => row.currency === "USD");
    const cny = money.lines.find((row) => row.currency === "CNY");
    expect(usd?.contractMinor).toBe(BigInt(100000));
    expect(usd?.receivableMinor).toBe(BigInt(30000));
    expect(usd?.receivedMinor).toBe(BigInt(20000));
    expect(usd?.receivableOpenMinor).toBe(BigInt(10000));
    expect(cny?.paidMinor).toBe(BigInt(3000));
    expect(cny?.payableOpenMinor).toBe(BigInt(5000));
    expect(money.facts.join(" ")).toContain("不是银行执行");
    expect(money.facts.join(" ")).not.toContain("借方");
  });

  it("没有合同和确认款项时不编金额", () => {
    const money = evaluateOrderMoney({ contract: null, bills: [] });
    expect(money.hasContract).toBe(false);
    expect(money.lines).toEqual([]);
    expect(money.label).toContain("还没有登记收付");
  });
});

describe("本单收付服务", () => {
  beforeEach(async () => {
    await resetDatabase();
    sequence = 0;
  });

  it("业务员无需外贸权限也能看本单核销，隔离组织看不到", async () => {
    await run({
      action: "save_contract",
      orderId: "order-demo-005",
      currency: "USD",
      amount: "1000",
      tradeMode: "unknown",
      incoterm: "FOB（待核）",
      terms: "本单收付案例",
      expectedVersion: 0,
    });
    const first = await run({
      action: "create_bill",
      orderId: "order-demo-005",
      direction: "receivable",
      title: "订金",
      category: "deposit",
      currency: "USD",
      amount: "300",
      dueDate: "2026-09-20",
      basis: "客户确认订金",
    });
    await run({
      action: "create_bill",
      orderId: "order-demo-005",
      direction: "receivable",
      title: "尾款草稿",
      category: "balance",
      currency: "USD",
      amount: "700",
      dueDate: "2026-10-20",
      basis: "未确认尾款",
    });
    await run({ action: "confirm_bill", id: first.id, expectedVersion: 1 });
    const cash = await run({
      action: "record_cash",
      direction: "receive",
      partyId: "customer-qinglan",
      currency: "USD",
      amount: "200",
      fee: "0",
      bankAccount: "演示美元账户",
      bankReference: "BANK-MONEY-200",
      occurredOn: "2026-09-20",
      basis: "人工核对银行回单",
    });
    await run({
      action: "allocate",
      billId: first.id,
      cashId: cash.id,
      cashAmount: "200",
      expectedBillVersion: 2,
      expectedCashVersion: 1,
    });

    const salesView = await getOrderMoney(IDS.orgDemo, "order-demo-005");
    expect(salesView.contractAmount).toBe("1000.00");
    expect(salesView.lines[0]).toMatchObject({
      currency: "USD",
      receivable: "300.00",
      received: "200.00",
      receivableOpen: "100.00",
    });
    expect(salesView.draftReceivableCount).toBe(1);
    expect(salesView.facts.join(" ")).toContain("不是银行执行");

    await expect(getOrderMoney(IDS.orgIso, "order-demo-005")).rejects.toThrow(/不存在|组织/);
  });
});
