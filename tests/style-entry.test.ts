import { beforeEach, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createStyleMaster } from "@/server/services/style-create";
import { createFollowSheet } from "@/server/services/order-merch";
import { listStyleFollowLinks } from "@/server/services/style-follow-links";
import { listStyleSummaries } from "@/server/services/style-thread";
import { businessTools } from "@/server/agents/business-tools";
import { resolveContext } from "@/server/context/context-service";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
beforeEach(resetDatabase);

it("自填款号与季节同事务保存并审计，跨组织季节不留下半张主档", async () => {
  const result = await createStyleMaster({ ...actor, code: "客户自编-圆领 A/01", name: "圆领上衣", seasonId: IDS.seasonSs26 });
  const style = await prisma.style.findUniqueOrThrow({ where: { id: result.styleId }, include: { seasonLinks: true } });
  expect(style.code).toBe("客户自编-圆领 A/01");
  expect(style.seasonLinks.map(s => s.seasonId)).toEqual([IDS.seasonSs26]);
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: style.id, action: "style.master.created" } });
  expect(audit.actorUserId).toBe(actor.userId);
  expect(audit.createdAt).toBeInstanceOf(Date);
  expect(JSON.parse(audit.payloadJson!).after.seasonId).toBe(IDS.seasonSs26);
  const count = await prisma.style.count();
  await expect(createStyleMaster({ organizationId: IDS.orgIso, userId: IDS.userIso, role: "salesperson", code: "任意款号", name: "隔离款", seasonId: IDS.seasonSs26 })).rejects.toThrow("季节");
  expect(await prisma.style.count()).toBe(count);
});

it("同款分别登记多 PO，重试幂等；不沿用旧颜色数量、批准或生产单，智能体可回查", async () => {
  const before = { styles: await prisma.style.count(), orders: await prisma.salesOrder.findMany(), versions: await prisma.styleVersion.findMany(), purchases: await prisma.purchaseDraft.count() };
  const first = { ...actor, kind: "bulk", title: "新 PO 跟单", factoryName: "云杉服装工厂", customerId: IDS.customerNorthshore, sourceStyleId: IDS.styleSt26018, sourcePo: "PO-NEW-01", idempotencyKey: "style-entry-one" };
  const result = await createFollowSheet(first);
  expect((await createFollowSheet(first)).sheetId).toBe(result.sheetId);
  await createFollowSheet({ ...first, sourcePo: "PO-NEW-02", idempotencyKey: "style-entry-two" });
  const row = await prisma.orderMerchStyle.findFirstOrThrow({ where: { sheetId: result.sheetId } });
  expect(row.styleCode).toBe("ST-26018");
  expect(JSON.parse(row.bulkJson)).toMatchObject({ po: "PO-NEW-01", colors: [] });
  expect(row.productionLineId).toBeNull();
  expect(await prisma.style.count()).toBe(before.styles);
  expect(await prisma.salesOrder.findMany()).toEqual(before.orders);
  expect(await prisma.styleVersion.findMany()).toEqual(before.versions);
  expect(await prisma.purchaseDraft.count()).toBe(before.purchases);
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: result.sheetId, action: "follow.sheet_created" } });
  expect(audit.actorUserId).toBe(actor.userId);
  expect(JSON.parse(audit.payloadJson!).after).toMatchObject({ sourceStyleId: IDS.styleSt26018, styles: [{ bulk: { po: "PO-NEW-01" } }] });
  const card = (await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!;
  expect(card.followPos.map(p => p.po)).toEqual(expect.arrayContaining(["PO-NEW-01", "PO-NEW-02"]));
  expect(card.orderPos.some(p => p.po === "NB-PO-2025-088")).toBe(true);
  const registry = businessTools(actor, "follow", "查 PO-NEW-01");
  const found = await registry.tools.find(t => t.name === "read_follow_records")!.run({ query: "PO-NEW-01", from: "", to: "" }) as { total: number };
  expect(found.total).toBe(1);
  expect((await resolveContext(actor, "follow")).instructions).toContain("登记新 PO");
});

it("旧款号仍关联同款；归档、跨组织款与工厂角色不能从此入口建 PO", async () => {
  const input = { ...actor, kind: "bulk", title: "款式 PO", factoryName: "云杉服装工厂", sourceStyleId: IDS.styleSt26018, sourcePo: "PO-ALIAS", idempotencyKey: "style-entry-alias" };
  const created = await createFollowSheet(input);
  await prisma.orderMerchSheet.update({ where: { id: created.sheetId }, data: { salesOrderId: "order-demo-001" } });
  const legacy = (await listStyleFollowLinks(actor.organizationId)).get(IDS.styleSt26018)!.find(row => row.po === "PO-ALIAS")!;
  expect(legacy.productionOrderId).toBeNull();
  expect(legacy.productionLinkPending).toBe(true);
  await prisma.styleCodeAlias.create({ data: { id: "style-entry-old-code", organizationId: actor.organizationId, styleId: IDS.styleSt26018, code: "ST-26018" } });
  await prisma.style.update({ where: { id: IDS.styleSt26018 }, data: { code: "自由款号-001" } });
  const linked = (await listStyleFollowLinks(actor.organizationId)).get(IDS.styleSt26018)!;
  expect(linked.find(p => p.po === "PO-ALIAS")?.href).toBe(`/orders/follow/${created.sheetId}?row=0#follow-batch`);
  expect((await listStyleFollowLinks(IDS.orgIso)).size).toBe(0);
  expect((await listStyleFollowLinks(actor.organizationId, { role: "factory", factoryId: "other-factory" })).size).toBe(0);
  const count = await prisma.orderMerchSheet.count();
  await expect(createFollowSheet({ ...input, userId: IDS.userFactory, role: "factory", idempotencyKey: "style-entry-factory" })).rejects.toThrow("不能");
  await expect(createFollowSheet({ ...input, organizationId: IDS.orgIso, userId: IDS.userIso, idempotencyKey: "style-entry-foreign" })).rejects.toThrow("原款式");
  await prisma.style.update({ where: { id: IDS.styleSt26018 }, data: { archivedAt: new Date() } });
  await expect(createFollowSheet({ ...input, idempotencyKey: "style-entry-archived" })).rejects.toThrow("归档");
  expect(await prisma.orderMerchSheet.count()).toBe(count);
});

it("款式工厂来自实际订单和跟单，去重且工厂账号只看自己的关联", async () => {
  const factory = await prisma.party.findUniqueOrThrow({ where: { id: IDS.factoryYunshan } });
  await prisma.salesOrder.update({ where: { id: IDS.orderHistorical }, data: { factoryId: factory.id } });
  await createFollowSheet({ ...actor, kind: "bulk", title: "同厂另一 PO", factoryId: factory.id, factoryName: factory.name, sourceStyleId: IDS.styleSt26018, idempotencyKey: "factory-card-same" });
  const another = await createFollowSheet({ ...actor, kind: "bulk", title: "另一工厂", factoryName: "另一家打样厂", sourceStyleId: IDS.styleSt26018, idempotencyKey: "factory-card-other" });
  const sample = await createFollowSheet({ ...actor, kind: "sales_sample", title: "销售样工厂", sourceStyleId: IDS.styleSt26018, idempotencyKey: "factory-card-sample" });
  const sampleRow = await prisma.orderMerchStyle.findFirstOrThrow({ where: { sheetId: sample.sheetId } });
  await prisma.orderMerchStyle.update({ where: { id: sampleRow.id }, data: { salesSampleJson: JSON.stringify({ ...JSON.parse(sampleRow.salesSampleJson), factoryName: "销售样打样厂" }) } });
  const cards = await listStyleSummaries(actor.organizationId);
  const names = cards.find(s => s.id === IDS.styleSt26018)!.factoryNames;
  expect(cards.find(s => s.id === IDS.styleSt26018)!.factories).toEqual(expect.arrayContaining([
    { id: factory.id, name: factory.name }, { id: null, name: "销售样打样厂" },
  ]));
  expect(names).toEqual(expect.arrayContaining([factory.name, "另一家打样厂", "销售样打样厂"]));
  expect(names.filter(name => name === factory.name)).toHaveLength(1);
  const scoped = await listStyleSummaries(actor.organizationId, { role: "factory", factoryId: factory.id });
  expect(scoped.find(s => s.id === IDS.styleSt26018)!.factoryNames).toEqual([factory.name]);
  expect(await listStyleSummaries(actor.organizationId, { role: "factory", factoryId: "no-such-factory" })).toEqual([]);
  expect((await listStyleSummaries(IDS.orgIso)).some(s => s.id === IDS.styleSt26018)).toBe(false);
  await prisma.orderMerchSheet.update({ where: { id: another.sheetId }, data: { archivedAt: new Date() } });
  expect((await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!.factoryNames).not.toContain("另一家打样厂");
  const empty = await createStyleMaster({ ...actor, code: "FACTORY-PENDING", name: "尚未安排工厂" });
  expect((await listStyleSummaries(actor.organizationId)).find(s => s.id === empty.styleId)!.factoryNames).toEqual([]);
  await prisma.party.update({ where: { id: factory.id }, data: { name: "云杉服装新名称" } });
  const renamed = (await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!.factories;
  expect(renamed.filter(item => item.id === factory.id)).toEqual([{ id: factory.id, name: "云杉服装新名称" }]);
  expect(renamed.some(item => item.name === factory.name)).toBe(false);
  const sampleFactory = { id: "factory-card-sample-party", organizationId: actor.organizationId, kind: "factory", code: "FACTORY-CARD-SAMPLE", name: "销售样打样厂", demoNote: "" };
  await prisma.party.create({ data: { ...sampleFactory, id: "factory-card-foreign-party", organizationId: IDS.orgIso } });
  expect((await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!.factories).toContainEqual({ id: null, name: sampleFactory.name });
  await prisma.party.create({ data: sampleFactory });
  expect((await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!.factories).toContainEqual({ id: sampleFactory.id, name: sampleFactory.name });
  await prisma.party.create({ data: { ...sampleFactory, id: "factory-card-duplicate-party", code: "FACTORY-CARD-DUPLICATE" } });
  expect((await listStyleSummaries(actor.organizationId)).find(s => s.id === IDS.styleSt26018)!.factories).toContainEqual({ id: null, name: sampleFactory.name });
});
