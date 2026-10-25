import { beforeEach, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { choicesForField } from "@/lib/pattern-choices";
import { getPatternBoard, savePatternDraft } from "@/server/services/pattern-workflow";
import { rememberPatternChoices } from "@/server/services/pattern-choices";
import { resetDatabase } from "./helpers";

const sales = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
const factory = { ...sales, userId: IDS.userFactory, role: "factory", factoryId: IDS.factoryYunshan };
async function create(id: string, organizationId: string = IDS.orgDemo) {
  await prisma.developmentProject.create({ data: { id, organizationId, code: `DEV-${id}`, name: id, status: "open", unknownsJson: "[]" } });
}
async function request(id: string, fields: Record<string, string>) {
  const board = await getPatternBoard(sales, id);
  return { projectId: id, idempotencyKey: crypto.randomUUID(), expectedUpdatedAt: board.updatedAt, contextStamp: board.contextStamp, craftFamily: "sweater", sweater: { ...board.content.sweater, ...fields }, fabric: board.content.fabric };
}
beforeEach(resetDatabase);

it("移出候选只影响本人，当前版单与来源仍保留；刷新、再次保存不复活，恢复留审计且幂等", async () => {
  await create("visibility");
  await savePatternDraft(sales, await request("visibility", { yarnSupplier: "保留记录的供应商" }));
  const original = await getPatternBoard(sales, "visibility");
  const change = { field: "sweater.yarnSupplier", value: "保留记录的供应商", hidden: true, expectedHidden: false };
  const input = { ...await request("visibility", {}), choiceVisibility: [change] };
  await savePatternDraft(sales, input); await savePatternDraft(sales, input);
  await savePatternDraft(sales, await request("visibility", {}));
  const hidden = await getPatternBoard(sales, "visibility");
  expect(hidden.content).toEqual(original.content);
  expect(hidden.contextStamp).toBe(original.contextStamp);
  expect(hidden.choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: change.value, hidden: true }));
  const colleague = await getPatternBoard({ ...sales, userId: IDS.userManager, role: "manager" }, "visibility");
  expect(colleague.choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: change.value, hidden: false }));
  expect(await prisma.auditEvent.count({ where: { action: "development.pattern_choice_visibility" } })).toBe(1);
  await expect(savePatternDraft(sales, { ...await request("visibility", {}), choiceVisibility: [change] })).rejects.toThrow(/候选设置已变化/);
  await savePatternDraft(sales, { ...await request("visibility", {}), choiceVisibility: [{ ...change, hidden: false, expectedHidden: true }] });
  expect((await getPatternBoard(sales, "visibility")).choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: change.value, hidden: false }));
  const audits = await prisma.auditEvent.findMany({ where: { action: "development.pattern_choice_visibility" }, orderBy: { createdAt: "asc" } });
  expect(audits).toHaveLength(2);
  expect(audits.every(row => row.actorUserId === sales.userId && row.createdAt)).toBe(true);
  expect(JSON.parse(audits[1].payloadJson!)).toMatchObject({ before: { hidden: true }, after: { hidden: false }, basis: { projectId: "visibility" } });
});

it("候选移出不能伪造用户或未知值，版单后续校验失败时移出和审计一起回滚", async () => {
  await create("visibility-fail");
  const change = { field: "sweater.needleType", value: "12G", hidden: true, expectedHidden: false };
  await expect(savePatternDraft(sales, { ...await request("visibility-fail", {}), choiceVisibility: [{ ...change, userId: IDS.userManager }] })).rejects.toThrow();
  await expect(savePatternDraft(sales, { ...await request("visibility-fail", {}), choiceVisibility: [{ ...change, value: "不存在的私有候选" }] })).rejects.toThrow(/候选来源已变化/);
  await expect(savePatternDraft(sales, { ...await request("visibility-fail", {}), choiceVisibility: [change], references: [{ id: "bad" }] })).rejects.toThrow();
  expect(await prisma.organizationPolicy.count({ where: { key: { startsWith: "pattern:choice-visibility:" } } })).toBe(0);
  expect(await prisma.auditEvent.count({ where: { action: "development.pattern_choice_visibility" } })).toBe(0);
  const disabledInput = { ...await request("visibility-fail", {}), choiceVisibility: [change] };
  await prisma.user.update({ where: { id: sales.userId }, data: { active: false } });
  await expect(savePatternDraft(sales, disabledInput)).rejects.toThrow(/无权/);
});

it("已存供应商和材料给候选；自填只在保存时记住，之后修改原版单仍保留，并完整留痕且幂等", async () => {
  await create("choices-source"); await create("choices-next");
  await prisma.developmentProject.update({ where: { id: "choices-source" }, data: { craftFamily: "sweater", sheetJson: JSON.stringify({ sweater: { yarnSupplier: "原有旧版供应商" } }) } });
  await prisma.material.update({ where: { id: IDS.materialMat001 }, data: { composition: "97%棉 3%氨纶", gsm: "220", widthCm: "150" } });
  const partyCount = await prisma.party.count();
  const initial = await getPatternBoard(sales, "choices-source");
  const supplier = await prisma.party.findUniqueOrThrow({ where: { id: IDS.supplierQinghe } });
  expect(initial.choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: supplier.name, source: "供应商主档" }));
  expect(initial.choices?.["fabric.fabricComposition"]).toContainEqual(expect.objectContaining({ value: "97%棉 3%氨纶", source: "面辅料库" }));
  expect(initial.choices?.["fabric.width"]).toContainEqual(expect.objectContaining({ value: "150", source: "面辅料库" }));
  expect(initial.choices?.["sweater.needleType"]).toContainEqual(expect.objectContaining({ value: "12G", source: expect.stringContaining("示例") }));

  const input = await request("choices-source", { yarnSupplier: "新增纱行", yarnPrice: "CNY 68/kg（100kg起）", yarnCount: "3/68 自定", yarnComposition: "本款混纺", needleType: "9G", inStock: "yes" });
  expect(JSON.stringify(initial.choices)).not.toContain("新增纱行");
  await savePatternDraft(sales, input);
  const count = await prisma.organizationPolicy.count({ where: { key: { startsWith: "pattern:entry-choice:" } } });
  await savePatternDraft(sales, input);
  expect(await prisma.organizationPolicy.count({ where: { key: { startsWith: "pattern:entry-choice:" } } })).toBe(count);
  await savePatternDraft(sales, await request("choices-source", { yarnSupplier: "另一家纱行", yarnCount: "2/32", yarnPrice: "" }));
  const next = await getPatternBoard(sales, "choices-next");
  expect(next.content.sweater.yarnSupplier).toBe("");
  expect(next.choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: "新增纱行", source: "已保存版单" }));
  expect(next.choices?.["sweater.yarnSupplier"]).toContainEqual(expect.objectContaining({ value: "原有旧版供应商" }));
  expect(next.choices?.["fabric.supplier"]).toContainEqual(expect.objectContaining({ value: "新增纱行" }));
  expect(next.choices?.["sweater.yarnCount"]).toContainEqual(expect.objectContaining({ value: "3/68 自定" }));
  expect(next.contextStamp).toBe(initial.contextStamp); // typing history is not a newly published rule
  expect(await prisma.party.count()).toBe(partyCount);
  expect(Object.keys(next.choices!)).not.toContain("sweater.inStock");
  const audits = await prisma.auditEvent.findMany({ where: { action: "development.pattern_choice_remembered" } });
  expect(audits.length).toBeGreaterThan(0);
  for (const audit of audits) {
    expect(audit.actorUserId).toBe(sales.userId); expect(audit.createdAt).toBeInstanceOf(Date);
    const payload = JSON.parse(audit.payloadJson!);
    expect(payload.before).toBeNull(); expect(payload.after.value).toBeTruthy(); expect(payload.basis.projectId).toBe("choices-source");
    expect(await prisma.auditEvent.findUnique({ where: { id: payload.basis.patternAuditId } })).not.toBeNull();
  }
});

it("历史价只按本字段及所选供应商提供，显示材料依据；公司和工厂权限隔离", async () => {
  await create("supplier-a"); await create("supplier-b"); await create("other-org", IDS.orgIso);
  await savePatternDraft(sales, await request("supplier-a", { yarnSupplier: "甲纱行", yarnPrice: "USD 12/kg", yarnComposition: "100%羊毛", yarnCount: "2/48" }));
  await savePatternDraft(sales, await request("supplier-b", { yarnSupplier: "乙纱行", yarnPrice: "CNY 80/kg" }));
  const board = await getPatternBoard(sales, "supplier-a");
  const rows = choicesForField(board.choices!, "sweater.yarnPrice", " 甲纱行 ");
  expect(rows).toContainEqual(expect.objectContaining({ value: "USD 12/kg", supplier: "甲纱行", source: "历史填写 · 待核对", detail: expect.stringContaining("100%羊毛 · 2/48") }));
  expect(rows.some(row => row.value === "CNY 80/kg")).toBe(false);
  expect(choicesForField(board.choices!, "sweater.yarnPrice", "")).toEqual([]);
  expect(choicesForField(board.choices!, "fabric.price", "甲纱行")).toEqual([]);
  const other = await getPatternBoard({ ...sales, organizationId: IDS.orgIso, userId: IDS.userIso }, "other-org");
  expect(JSON.stringify(other.choices)).not.toMatch(/甲纱行|乙纱行|USD 12\/kg/);
  await expect(getPatternBoard(factory, "supplier-a")).rejects.toThrow();
});

it("过期保存不记住输入；后续写入失败时，候选与候选审计随事务一起回滚", async () => {
  await create("stale-choice");
  const stale = await request("stale-choice", { yarnSupplier: "不应保存的供应商" });
  await savePatternDraft(sales, await request("stale-choice", { yarnSupplier: "有效供应商" }));
  await expect(savePatternDraft(sales, stale)).rejects.toThrow(/已变化/);
  const before = await getPatternBoard(sales, "stale-choice");
  expect(JSON.stringify(before.choices)).not.toContain("不应保存的供应商");
  await expect(prisma.$transaction(async db => {
    await rememberPatternChoices(db, sales, { id: before.projectId, code: before.code }, { ...before.content, sweater: { ...before.content.sweater, yarnSupplier: "事务回滚供应商" } }, "failed-audit");
    throw new Error("模拟后续写入失败");
  })).rejects.toThrow("模拟后续写入失败");
  expect(await prisma.organizationPolicy.count({ where: { valueJson: { contains: "事务回滚供应商" } } })).toBe(0);
  expect(await prisma.auditEvent.count({ where: { action: "development.pattern_choice_remembered", payloadJson: { contains: "事务回滚供应商" } } })).toBe(0);
});
