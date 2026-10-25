import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { bulkMainLabel, colorTrimText, normalizeMerchOrder, readBulk, readStoredMerchStyles, SAME_AS_CARE, specialProcessText } from "@/server/domain/merch-sheet";
import { createFollowSheet, listFollowProducts, saveFollowSheet } from "@/server/services/order-merch";
import { filterFollowProducts } from "@/lib/follow-search";
import { followPrintContent } from "@/lib/follow-print";
import { businessTools } from "@/server/agents/business-tools";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };

it("旧主唛不跨颜色猜补，旧洗尺唛原文保留，三类工艺合并后仍可明确清空", () => {
  const raw = { colors: [{ guestColor: "白", colorTrims: { mainLabel: "P-ML", careSizeLabel: "洗白尺黑", patch: "毛毡", embroidery: "红色绣花", bartack: "银色" } }, { guestColor: "黑", colorTrims: { mainLabel: "P-OTHER" } }] };
  const before = JSON.stringify(raw), bulk = readBulk(before);
  expect(JSON.stringify(raw)).toBe(before);
  expect(bulkMainLabel(bulk)).toBe("白：P-ML\n黑：P-OTHER");
  expect(bulk.colors[0].colorTrims?.careSizeLabel).toBe("洗白尺黑");
  expect(bulk.colors[0].colorTrims?.careLabel).toBeUndefined();
  expect(specialProcessText(bulk.colors[0])).toBe("贴布 / 毛毡：毛毡\n绣花 / 印花：红色绣花\n套结色：银色");
  bulk.colors[0].colorTrims!.specialProcess = "";
  expect(specialProcessText(readBulk(JSON.stringify(bulk)).colors[0])).toBe("");
  expect(bulk.colors[0].colorTrims?.embroidery).toBe("红色绣花");
  expect(bulkMainLabel({ ...bulk, mainLabel: "" })).toBe("");
});

it("同洗唛只在明确选择后联动，不覆盖规格或独立颜色，未知颜色不能猜填", () => {
  const bulk = readBulk(JSON.stringify({ colors: [{ labelColors: { careLabel: "灰色", sizeLabel: "白色", instructionLabel: SAME_AS_CARE, spareLabel: "黑色" }, colorTrims: { instructionLabel: "折边" } }] }));
  const c = bulk.colors[0]; expect(colorTrimText(c, "instructionLabel")).toBe("同洗唛（灰色） · 折边");
  c.labelColors!.careLabel = "本白";
  expect(colorTrimText(c, "instructionLabel")).toContain("本白"); expect(colorTrimText(c, "spareLabel")).toBe("黑色");
  c.labelColors!.careLabel = ""; expect(colorTrimText(c, "instructionLabel")).toContain("待选");
  expect(() => normalizeMerchOrder({ styles: [{ bulk: { colors: [{ labelColors: { careLabel: SAME_AS_CARE } }] } }] })).toThrow(/独立/);
});

it("新增元素禁止静默丢弃名称、超额图片和重复标记", () => {
  const element = { id: "element-1", label: "包装袋", text: "可回收", images: ["/api/sheet-images/element-photo-01"] };
  const normalize = (elements: unknown[]) => normalizeMerchOrder({ styles: [{ salesSample: { elements } }] });
  expect(normalize([element]).styles[0].salesSample.elements).toEqual([element]);
  expect(() => normalize([{ ...element, label: "" }])).toThrow(/名称/);
  expect(() => normalize([element, element])).toThrow(/重复/);
  expect(() => normalize([{ ...element, images: ["https://outside.example/a.jpg"] }])).toThrow(/图片/);
});

describe("跟单新元素和唛标服务闭环", () => {
  beforeEach(resetDatabase);
  it("保存再回查、每PO独立、审计与重试，以及总表检索和打印使用同一份内容", async () => {
    const created = await createFollowSheet({ ...actor, kind: "bulk", title: "唛标调整", factoryName: "云杉服装工厂", idempotencyKey: "labels-create-001" });
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    const row = (po: string, main: string) => ({ styleCode: "ST-26003", bulk: { po, mainLabel: main, colors: ["红色", "黑色"].map(guestColor => ({ guestColor, qtyText: "20", colorTrims: { careSizeLabel: "原合并说明", careLabel: "成分表", sizeLabel: "字母 S-XL", instructionLabel: "折边", specialProcess: "红色绣花、套结" }, labelColors: { careLabel: "灰色", sizeLabel: "白色", instructionLabel: SAME_AS_CARE, spareLabel: "黑色" } })) } });
    const payload = { ...actor, sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), idempotencyKey: "labels-save-001", factoryName: sheet.factoryName, styles: [row("PO-1", "统一主唛"), row("PO-2", "另一批主唛")] };
    const saved = await saveFollowSheet(payload); await saveFollowSheet(payload);
    const fresh = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: sheet.id }, include: { styles: { orderBy: { sort: "asc" } } } });
    expect(readStoredMerchStyles(fresh, { styleCode: "", styleName: "" }).map(s => s.bulk.mainLabel)).toEqual(["统一主唛", "另一批主唛"]);
    const audits = await prisma.auditEvent.findMany({ where: { entityId: sheet.id, action: "follow.merch_saved" } });
    expect(audits).toHaveLength(1); expect(audits[0].actorUserId).toBe(actor.userId); expect(audits[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(audits[0].payloadJson!).after.styles[0].bulk.mainLabel).toBe("统一主唛");
    const lists = await listFollowProducts(actor.organizationId, { role: "salesperson", factoryId: null });
    const result = filterFollowProducts(lists, "统一主唛").bulk.flatMap(g => g.styles);
    expect(result).toHaveLength(1); expect(result[0].po).toBe("PO-1");
    const print = followPrintContent(result[0], ["labels", "trims"]);
    expect(print.mainLabel).toBe("统一主唛"); expect(print.rows[0].labels).toContainEqual({ label: "说明唛", value: "同洗唛（灰色） · 折边" });
    expect(print.rows[0].trims).toContainEqual({ label: "特殊工艺", value: "红色绣花、套结" });
    const registry = businessTools({ ...actor, factoryId: null }, "follow", "查统一主唛");
    await registry.tools.find(t => t.name === "read_follow_records")!.run({ query: "统一主唛", from: "", to: "" });
    expect(registry.tables[1].rows[0].cells[2]).toContain("本款主唛：统一主唛");
    expect(registry.tables[1].rows[0].cells[2]).toContain("同洗唛（灰色）");
    expect(registry.tables[1].rows[0].cells[2]).toContain("特殊工艺：红色绣花、套结");
    await expect(saveFollowSheet({ ...payload, idempotencyKey: "labels-deny-001", role: "factory", userId: IDS.userFactory, expectedUpdatedAt: saved.expectedUpdatedAt })).rejects.toThrow(/不能改/);
  });
  it("销售样添加图文元素经保存后出现在列表和审计，移除也保留历史", async () => {
    const created = await createFollowSheet({ ...actor, kind: "sales_sample", title: "样品元素", idempotencyKey: "elements-create-001" });
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    const element = { id: "element-1", label: "特殊包装袋", text: "再生纸袋", images: ["/api/sheet-images/sample-element-01"] };
    const payload = { ...actor, sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), idempotencyKey: "elements-save-001", styles: [{ styleCode: "ST-26003", salesSample: { elements: [element] } }] };
    const saved = await saveFollowSheet(payload);
    const lists = await listFollowProducts(actor.organizationId, { role: "salesperson", factoryId: null });
    expect(filterFollowProducts(lists, "特殊包装袋").sales[0].sampleElements).toEqual([element]);
    saved.styles[0].salesSample.elements = [];
    await saveFollowSheet({ ...payload, idempotencyKey: "elements-remove-001", expectedUpdatedAt: saved.expectedUpdatedAt, styles: saved.styles });
    const events = await prisma.auditEvent.findMany({ where: { entityId: sheet.id, action: "follow.merch_saved" } });
    expect(events.some(e => JSON.parse(e.payloadJson!).before.styles[0]?.salesSample.elements?.[0]?.label === element.label)).toBe(true);
  });
});
