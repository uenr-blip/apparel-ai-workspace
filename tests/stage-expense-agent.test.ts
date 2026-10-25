import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { businessTools } from "@/server/agents/business-tools";
import { runBusinessAgent } from "@/server/agents/business-agent";
import type { Completion } from "@/server/agents/runtime";
import { expenseSubject } from "@/server/services/stage-expenses";
import { runTradeCommand } from "@/server/services/trade-write";
import { setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";

const manager = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
const sales = { ...manager, userId: IDS.userSales, role: "salesperson" };
const key = () => crypto.randomUUID();
const project = (code = "DEV-FEE-001", organizationId = IDS.orgDemo) => prisma.developmentProject.create({ data: { id: key(), organizationId, code, name: "未保存用料的费用款", status: "open", unknownsJson: "[]", craftFamily: "knit" } });

beforeEach(resetDatabase);
describe("财务智能体阶段费用入口（协议模拟）", () => {
  it("未保存阶段用料仍能按真实开发编号查费用；草稿不计欠款，无业务写入", async () => {
    const p = await project(), target = { projectId: p.id };
    const subject = await expenseSubject(manager, target);
    const bill = await runTradeCommand(manager, { action: "create_stage_expense", ...target, expectedStamp: subject.stamp, partyId: IDS.factoryYunshan, title: "头版加工费", expenseKind: "sampling", amount: "100.50", currency: "CNY", dueDate: "2026-10-10", expenseDate: "2026-09-28", expenseReference: key(), basis: "测试打样报价单", idempotencyKey: key() });
    expect(await prisma.workflowStage.count({ where: target })).toBe(0);
    const before = await prisma.tradeBill.findMany();
    let step = 0;
    const completion: Completion = async messages => {
      if (++step === 1) return { content: null, tool_calls: [{ id: "find", type: "function", function: { name: "find_stage_expense_subjects", arguments: JSON.stringify({ query: p.code, stage: "development" }) } }] };
      if (step === 2) {
        const found = JSON.parse(messages.at(-1)!.content!);
        expect(found.requiresClarification).toBe(false);
        return { content: null, tool_calls: [{ id: "read", type: "function", function: { name: "read_stage_expenses", arguments: JSON.stringify({ projectId: found.candidates[0].projectId }) } }] };
      }
      return { content: "已列出阶段费用草稿，由财务核对。" };
    };
    const result = await runBusinessAgent(manager, "finance", `${p.code} 的开发费用有哪些`, completion);
    expect(result.steps).toHaveLength(2);
    expect(result.evidenceRead).toBe(true);
    const table = result.tables.find(t => t.title.endsWith("阶段费用"))!;
    expect(table.rows).toEqual([expect.objectContaining({ href: `/finance/bills/${bill.id}`, cells: expect.arrayContaining(["100.50", "草稿，不计欠款"]) })]);
    expect(table.notes?.join()).toContain("未复制或分摊");
    expect(await prisma.tradeBill.findMany()).toEqual(before);
    expect(await prisma.tradeCash.count()).toBe(0);
    const audit = await prisma.auditEvent.findUniqueOrThrow({ where: { id: result.runId } });
    expect(JSON.parse(audit.payloadJson!).tools.map((t: { name: string }) => t.name)).toEqual(["find_stage_expense_subjects", "read_stage_expenses"]);
  });

  it("多候选、猜编号和跨组织不读金额；已归档资料仍可追溯", async () => {
    const p = await project(), other = await project("DEV-FEE-002"), foreign = await project("DEV-FOREIGN", IDS.orgIso);
    const registry = businessTools(manager, "finance", "查阶段费用");
    const find = registry.tools.find(t => t.name === "find_stage_expense_subjects")!;
    const read = registry.tools.find(t => t.name === "read_stage_expenses")!;
    await expect(read.run({ projectId: p.id })).rejects.toThrow(/先定位唯一/);
    expect(await find.run({ query: "DEV-FEE" })).toMatchObject({ requiresClarification: true });
    await expect(read.run({ projectId: other.id })).rejects.toThrow(/先定位唯一/);
    expect(await find.run({ query: foreign.code })).toMatchObject({ candidates: [] });
    await expect(read.run({ projectId: foreign.id })).rejects.toThrow(/先定位唯一/);
    await prisma.developmentProject.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
    expect(await find.run({ query: p.code })).toMatchObject({ candidates: [{ projectId: p.id, archived: true }], requiresClarification: false });
    expect(await read.run({ projectId: p.id })).toMatchObject({ records: [] });
    expect(registry.tables.at(-1)?.emptyMessage).toContain("不能据此认定未发生费用");
    await find.run({ query: "不存在" });
    await expect(read.run({ projectId: p.id })).rejects.toThrow(/先定位唯一/);
  });

  it("销售样和大货按阶段定位，未授权或中途撤权均拒绝", async () => {
    for (const kind of ["sales_sample", "bulk"]) await prisma.orderMerchSheet.create({ data: { id: key(), organizationId: IDS.orgDemo, title: `费用验证${kind}`, kind, styles: { create: { id: key(), sort: 0, styleCode: "EXP-STAGE-001", styleName: "费用验证款" } } } });
    const blocked = vi.fn<Completion>();
    await expect(runBusinessAgent(sales, "finance", "查阶段费用", blocked)).rejects.toThrow(/无权/);
    expect(blocked).not.toHaveBeenCalled();
    const permission = { organizationId: manager.organizationId, managerId: manager.userId, targetUserId: sales.userId, action: "trade_view" };
    await setUserPermission({ ...permission, enabled: true });
    const registry = businessTools(sales, "finance", "销售样费用");
    const find = registry.tools.find(t => t.name === "find_stage_expense_subjects")!;
    const read = registry.tools.find(t => t.name === "read_stage_expenses")!;
    expect(await find.run({ query: "EXP-STAGE-001" })).toMatchObject({ requiresClarification: true });
    const found = await find.run({ query: "EXP-STAGE-001", stage: "sales_sample" }) as { candidates: { followRowId: string }[]; requiresClarification: boolean };
    expect(found.requiresClarification).toBe(false);
    expect(await read.run({ followRowId: found.candidates[0].followRowId })).toMatchObject({ records: [] });
    await setUserPermission({ ...permission, enabled: false });
    await expect(read.run({ followRowId: found.candidates[0].followRowId })).rejects.toThrow(/无权/);
    await expect(find.run({ query: "EXP-STAGE-001" })).rejects.toThrow(/无权/);
  });
});
