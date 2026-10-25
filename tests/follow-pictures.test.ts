import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BULK_PICTURE_KEYS, COLOR_PICTURE_KEYS, normalizeMerchOrder, readStoredMerchStyles, SAME_AS_CARE } from "@/server/domain/merch-sheet";
import { createFollowSheet, listFollowProducts, saveFollowSheet } from "@/server/services/order-merch";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { followPrintContent } from "@/lib/follow-print";
import { BulkMasterPrint } from "@/app/(app)/orders/bulk-master-print";
import { businessTools } from "@/server/agents/business-tools";
import { resetDatabase } from "./helpers";

const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };
const picture = (key: string) => `/api/sheet-images/test-photo-${key}`;
const shared = Object.fromEntries(BULK_PICTURE_KEYS.map(key => [key, [picture(key)]]));
const colored = Object.fromEntries(COLOR_PICTURE_KEYS.map(key => [key, [picture(key)]]));

it("图片独立存入每个字段，只有图片的行保留，空图片不创建空款，写入拒绝非法路径和超量", () => {
  const normalize = (bulk: unknown) => normalizeMerchOrder({ styles: [{ bulk }] });
  const bulk = normalize({ pictures: shared, colors: [{ pictures: colored }] }).styles[0].bulk;
  expect(bulk.pictures).toEqual(shared); expect(bulk.colors[0].pictures).toEqual(colored);
  expect(normalize({ pictures: { mainLabel: [] } }).styles).toHaveLength(0);
  expect(() => normalize({ pictures: { mainLabel: ["https://example.com/a.png"] } })).toThrow(/图片/);
  expect(() => normalize({ colors: [{ pictures: { careLabel: Array(7).fill(picture("care")) } }] })).toThrow(/图片/);
  expect(() => normalize({ pictures: { unexpected: [picture("care")] } })).toThrow(/图片/);
});

describe("大货逐项图片保存与回查", () => {
  beforeEach(resetDatabase);
  it("同款不同PO与各色隔离、重试幂等、移除留审计，智能体和省纸打印带出同一份图片", async () => {
    const created = await createFollowSheet({ ...actor, kind: "bulk", title: "图片验收", factoryName: "云杉服装工厂", idempotencyKey: "pictures-create-01" });
    const sheet = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: created.sheetId } });
    const payload = { ...actor, sheetId: sheet.id, expectedUpdatedAt: sheet.updatedAt.toISOString(), factoryName: sheet.factoryName, idempotencyKey: "pictures-save-01", styles: [
      { styleCode: "ST-26003", bulk: { po: "PO-PHOTO-1", pictures: shared, colors: [
        { guestColor: "红色", qtyText: "10", pictures: colored, labelColors: { careLabel: "白色", instructionLabel: SAME_AS_CARE } },
        { guestColor: "蓝色", qtyText: "20", pictures: { careLabel: [picture("careLabel")] }, labelColors: { instructionLabel: SAME_AS_CARE } },
      ] } },
      { styleCode: "ST-26003", bulk: { po: "PO-PHOTO-2", colors: [{ guestColor: "红色", qtyText: "5" }] } },
    ] };
    const saved = await saveFollowSheet(payload); await saveFollowSheet(payload);
    const fresh = await prisma.orderMerchSheet.findUniqueOrThrow({ where: { id: sheet.id }, include: { styles: { orderBy: { sort: "asc" } } } });
    const styles = readStoredMerchStyles(fresh, { styleCode: "", styleName: "" });
    expect(styles[0].bulk.pictures).toEqual(shared); expect(styles[0].bulk.colors[0].pictures).toEqual(colored);
    expect(styles[0].bulk.colors[1].pictures?.instructionLabel).toBeUndefined();
    expect(styles[1].bulk.pictures).toBeUndefined(); expect(styles[1].bulk.colors[0].pictures).toBeUndefined();
    const audits = await prisma.auditEvent.findMany({ where: { entityId: sheet.id, action: "follow.merch_saved" } });
    expect(audits).toHaveLength(1); expect(audits[0].actorUserId).toBe(actor.userId); expect(audits[0].createdAt).toBeInstanceOf(Date);
    expect(JSON.parse(audits[0].payloadJson!).after.styles[0].bulk.pictures).toEqual(shared);
    const lists = await listFollowProducts(actor.organizationId, { role: "salesperson", factoryId: null });
    const line = lists.bulk.flatMap(g => g.styles).find(s => s.po === "PO-PHOTO-1")!;
    expect(line.bulkPictures).toEqual(shared); expect(line.colors[0].pictures).toEqual(colored);
    const print = followPrintContent(line, ["labels", "trims"]);
    expect(print.pictures).toHaveLength(13);
    expect(print.pictures.find(p => p.label === "洗唛")?.rows).toEqual([1, 2]);
    expect(print.pictures.find(p => p.label === "主唛")?.shared).toBe(true);
    expect(followPrintContent(line, []).pictures.map(p => p.label)).toEqual(["金属标"]);
    const html = renderToStaticMarkup(createElement(BulkMasterPrint, { name: "工厂", lines: [{ ...line, imageSrc: "" }], columns: ["labels", "trims"] }));
    expect((html.match(/<img /g) || []).length).toBe(13);
    expect(html).toContain("颜色行 01、02"); expect(html).not.toContain("rowspan");
    const registry = businessTools({ ...actor, factoryId: null }, "follow", "查 PO-PHOTO-1");
    const result = await registry.tools.find(t => t.name === "read_follow_records")!.run({ query: "PO-PHOTO-1", from: "", to: "" });
    expect(JSON.stringify(result)).toContain(picture("specialProcess"));
    expect(registry.tables[1].rows[0].cells[2]).toContain("主唛图片 1 张");
    saved.styles[0].bulk.pictures!.mainLabel = [];
    await saveFollowSheet({ ...payload, expectedUpdatedAt: saved.expectedUpdatedAt, idempotencyKey: "pictures-remove-01", styles: saved.styles });
    const after = await listFollowProducts(actor.organizationId, { role: "salesperson", factoryId: null });
    expect(after.bulk.flatMap(g => g.styles).find(s => s.po === "PO-PHOTO-1")!.bulkPictures?.mainLabel).toEqual([]);
    const history = await prisma.auditEvent.findMany({ where: { entityId: sheet.id, action: "follow.merch_saved" } });
    expect(history.some(e => JSON.parse(e.payloadJson!).before.styles[0]?.bulk.pictures?.mainLabel?.[0] === picture("mainLabel"))).toBe(true);
  });
});
