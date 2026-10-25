import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { constructionPublic, readConstruction, type ConstructionItem } from "@/lib/style-construction";
import { createStyleMaster } from "@/server/services/style-create";
import { constructionRows, constructionStamp, readConstructionImage, saveStyleConstruction } from "@/server/services/style-construction";
import { saveStyleProcessDraft } from "@/server/services/style-process";
import { saveStyleBomDraft } from "@/server/services/style-bom";
import { constructionForm } from "@/server/services/style-construction-http";
import { businessTools } from "@/server/agents/business-tools";
import { resolveContext } from "@/server/context/context-service";
import { previewOrderAssistant, searchOrderAssistant, confirmOrderAssistant } from "@/server/services/order-assistant";
import { referenceApprovedMaterials } from "@/server/services/order-prep";
import { resetDatabase } from "./helpers";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const rows: ConstructionItem[] = [
  { key: "fabric-1", group: "fabric", name: "纯棉大身面料", fields: { composition: "100%棉", specification: "单面汗布", gsm: "180", width: "150", consumption: "1.2", unit: "m", position: "大身" } },
  { key: "fabric-2", group: "fabric", name: "袋布", fields: { unit: "m" } },
  { key: "yarn-1", group: "yarn", name: "袖口纱线", fields: { composition: "棉", yarnCount: "32支/2股", unit: "kg" } },
  { key: "trim-1", group: "regularTrim", name: "金属标", fields: { color: "古铜", size: "2cm", consumption: "1", unit: "pcs" } },
  { key: "trim-2", group: "customTrim", name: "自定异形装饰", fields: { size: "3cm", unit: "pcs" } },
  { key: "craft-1", group: "process", name: "绣花", fields: { position: "左胸", size: "5×8cm", notes: "按图，不省略针脚要求" } },
];
async function load(id: string) { return prisma.styleVersion.findFirstOrThrow({ where: { styleId: id }, orderBy: { versionNumber: "desc" }, include: { bomLines: { include: { material: true }, orderBy: { materialId: "asc" } }, attachments: true } }); }
async function create() { return createStyleMaster({ ...actor, code: "QA-COMPONENT", name: "完整建款", construction: rows, constructionUploads: [{ key: "trim-1", bytes: png, name: "metal.png" }, { key: "craft-1", bytes: png, name: "embroider.png" }] }); }
beforeEach(resetDatabase);

describe("建款用料与工艺闭环", () => {
  it("从库选料后首次改规格生成独立材料，不把改后用料指向旧料", async () => {
    const material = await prisma.material.findFirstOrThrow({ where: { organizationId: actor.organizationId, kind: "fabric" } });
    const created = await createStyleMaster({ ...actor, code: "LIBRARY-EDIT", name: "选料后修改", construction: [{ key: "library-edit", group: "fabric", name: material.name, materialId: material.id, fields: { composition: "70%棉 30%麻", specification: material.specSummary, gsm: material.gsm, width: material.widthCm, unit: material.unit } }] });
    const saved = readConstruction((await load(created.styleId)).constructionJson)[0];
    expect(saved.materialId).not.toBe(material.id);
    expect((await prisma.material.findUniqueOrThrow({ where: { id: saved.materialId } })).composition).toBe("70%棉 30%麻");
    expect(await prisma.material.findUniqueOrThrow({ where: { id: material.id } })).toEqual(material);
  });
  it("基础档、多种面料纱线辅料、工艺与配图同次保存，未填单耗保留待核对，未开单采购", async () => {
    const counts = [await prisma.salesOrder.count(), await prisma.purchaseDraft.count()];
    const created = await create(); const v = await load(created.styleId);
    const saved = readConstruction(v.constructionJson);
    expect(saved).toHaveLength(6); expect(v.bomLines).toHaveLength(5);
    expect(v.bomLines.every(b => !b.confirmed)).toBe(true);
    expect(v.bomLines.find(b => b.material.name === "袋布")?.consumption).toBe("pending");
    expect(saved[2].fields.yarnCount).toBe("32支/2股");
    expect(saved[4].group).toBe("customTrim");
    expect((await readConstructionImage({ ...actor, styleId: created.styleId, versionId: v.id, key: "trim-1" })).bytes).toEqual(png);
    expect([await prisma.salesOrder.count(), await prisma.purchaseDraft.count()]).toEqual(counts);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: created.styleId, action: "style.master.created" } });
    expect(audit.actorUserId).toBe(actor.userId); expect(JSON.parse(audit.payloadJson!).after.construction).toHaveLength(6);
    const tools = businessTools({ ...actor, factoryId: null }, "development", "查看完整建款用料工艺");
    await tools.tools.find(t => t.name === "find_records")!.run({ query: "QA-COMPONENT" });
    const detail = tools.tools.find(t => t.name === "read_evidence")!;
    const evidence = await detail.run({ id: created.styleId });
    expect(JSON.stringify(evidence)).toContain("32支/2股");
    expect(JSON.stringify(evidence)).not.toContain("construction/" + actor.organizationId);
    expect(tools.tables.some(t => t.title.includes("用料与特殊工艺") && JSON.stringify(t.rows).includes("左胸"))).toBe(true);
    expect((await resolveContext({ ...actor, factoryId: null }, "development")).instructions).toContain("单耗未填是待核对");
  });
  it("编辑批准版生成新稿，旧图旧规格与其他引用不变；拒绝过期编辑", async () => {
    const created = await create(); let v = await load(created.styleId);
    await prisma.styleVersion.update({ where: { id: v.id }, data: { status: "approved" } }); v = await load(created.styleId);
    const stamp = constructionStamp(v); const oldJson = v.constructionJson;
    const edited = constructionPublic(constructionRows(v)); edited[0].fields.composition = "棉麻";
    edited[3].fields.color = "银色";
    const originalMaterial = v.bomLines.find(b => b.material.name === "纯棉大身面料")!.material;
    const result = await saveStyleConstruction({ ...actor, styleId: created.styleId, expectedStamp: stamp, rows: edited, uploads: [{ key: "trim-1", bytes: png, name: "silver.png" }] });
    expect(result.versionId).not.toBe(v.id);
    expect((await prisma.styleVersion.findUniqueOrThrow({ where: { id: v.id } })).constructionJson).toBe(oldJson);
    expect((await prisma.material.findUniqueOrThrow({ where: { id: originalMaterial.id } })).composition).toBe("100%棉");
    const next = await load(created.styleId); expect(next.versionNumber).toBe(2); expect(next.status).toBe("draft");
    expect(readConstruction(next.constructionJson)[0].materialId).not.toBe(originalMaterial.id);
    expect(readConstruction(next.constructionJson)[5].image?.path).toBe(readConstruction(oldJson)[5].image?.path);
    const count = await prisma.material.count();
    await expect(saveStyleConstruction({ ...actor, styleId: created.styleId, expectedStamp: stamp, rows: edited })).rejects.toThrow("已被修改");
    expect(await prisma.material.count()).toBe(count);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: next.id, action: "style.construction.saved" } });
    expect(JSON.parse(audit.payloadJson!).before[0].fields.composition).toBe("100%棉");
    expect(JSON.parse(audit.payloadJson!).after[0].fields.composition).toBe("棉麻");
  });
  it("角色、跨企业材料与图片、假图片和坏单耗均拦截，失败无半张主档", async () => {
    const bad = structuredClone(rows); bad[4].fields.consumption = "-1";
    const before = await prisma.material.count();
    await expect(createStyleMaster({ ...actor, code: "BAD", name: "坏数据", construction: bad })).rejects.toThrow("单耗");
    expect(await prisma.style.count({ where: { code: "BAD" } })).toBe(0); expect(await prisma.material.count()).toBe(before);
    await expect(createStyleMaster({ ...actor, code: "BAD", name: "坏图", construction: rows, constructionUploads: [{ key: "trim-1", bytes: Buffer.from("not png"), name: "x.png" }] })).rejects.toThrow("JPG");
    expect(await prisma.material.count()).toBe(before);
    const created = await create(); const v = await load(created.styleId);
    await expect(saveStyleConstruction({ ...actor, userId: IDS.userFactory, role: "factory", styleId: created.styleId, expectedStamp: constructionStamp(v), rows: [] })).rejects.toThrow("无权");
    await expect(readConstructionImage({ ...actor, organizationId: IDS.orgIso, userId: IDS.userIso, styleId: created.styleId, versionId: v.id, key: "trim-1" })).rejects.toThrow("不存在");
    await expect(readConstructionImage({ ...actor, role: "factory", userId: IDS.userFactory, styleId: created.styleId, versionId: v.id, key: "trim-1" })).rejects.toThrow("无权");
    const foreign = await prisma.material.findFirstOrThrow({ where: { organizationId: IDS.orgIso } });
    await expect(createStyleMaster({ ...actor, code: "FOREIGN", name: "跨组织", construction: [{ ...rows[0], materialId: foreign.id }] })).rejects.toThrow("材料不可用");
    expect(await prisma.style.count({ where: { code: "FOREIGN" } })).toBe(0);
    const forged = constructionPublic(constructionRows(v)); forged[0].imageId = "someone-elses-image";
    await expect(saveStyleConstruction({ ...actor, styleId: created.styleId, expectedStamp: constructionStamp(v), rows: forged })).rejects.toThrow("图片依据");
  });
  it("旧用料入口及工艺入口改版保留图片，删材料同步结构，工艺不是采购材料", async () => {
    const created = await create(); const first = await load(created.styleId);
    await prisma.styleVersion.update({ where: { id: first.id }, data: { status: "approved" } });
    await saveStyleProcessDraft({ ...actor, styleId: created.styleId, processNotes: "检查针脚", patternRevision: "2" });
    const second = await load(created.styleId); expect(second.constructionJson).toBe(first.constructionJson);
    const keep = readConstruction(second.constructionJson).find(r => r.key === "trim-1")!.materialId!;
    await saveStyleBomDraft({ ...actor, styleId: created.styleId, materialIds: [keep], consumptions: { [keep]: "2" } });
    const third = await load(created.styleId); const kept = readConstruction(third.constructionJson);
    expect(kept).toHaveLength(2); expect(kept[0].fields.consumption).toBe("2"); expect(kept[1].group).toBe("process");
    expect((await readConstructionImage({ ...actor, styleId: created.styleId, versionId: third.id, key: "trim-1" })).bytes).toEqual(png);
  });
  it("请求解析支持逐项图片并检查请求来源、重复项目和总大小", async () => {
    const form = new FormData(); form.set("construction", JSON.stringify(rows)); form.set("construction-image-trim-1", new File([png], "metal.png", { type: "image/png" }));
    const parsed = await constructionForm(new Request("http://localhost/api/styles", { method: "POST", body: form, headers: { origin: "http://localhost" } }));
    expect(parsed.rows).toHaveLength(6); expect(parsed.uploads[0].bytes).toEqual(png);
    await expect(constructionForm(new Request("http://localhost/api/styles", { method: "POST", body: form, headers: { origin: "http://elsewhere" } }))).rejects.toThrow("来源");
    await expect(constructionForm(new Request("http://localhost/api/styles", { method: "POST", body: form, headers: { "content-length": String(30 * 1024 * 1024) } }))).rejects.toThrow("大小");
    await expect(createStyleMaster({ ...actor, code: "BAD", name: "重复", construction: [rows[0], rows[0]] })).rejects.toThrow("项目编号重复");
  });
  it("智能体翻单携带结构参数与图片，资料变化后旧确认失效", async () => {
    const created = await create(); const v = await load(created.styleId);
    await prisma.style.update({ where: { id: created.styleId }, data: { code: "ST-CONSTRUCTION", name: "针织T恤" } });
    await prisma.styleVersion.update({ where: { id: v.id }, data: { status: "approved" } });
    const historical = await prisma.salesOrder.findFirstOrThrow({ where: { organizationId: IDS.orgDemo, customerId: IDS.customerNorthshore, status: { not: "draft" } } });
    await prisma.orderLine.create({ data: { id: "construction-history", orderId: historical.id, styleId: created.styleId, styleVersionId: v.id, totalQuantity: 100 } });
    const as = { ...actor, factoryId: null }, text = "给北岸服饰建 ST-CONSTRUCTION 订单";
    const candidates = await searchOrderAssistant(as, text); const candidate = candidates.candidates.find(c => c.styleId === created.styleId)!;
    expect(candidate.constructionJson).toBe(v.constructionJson);
    const preview = await previewOrderAssistant(as, { text, candidateId: candidate.id, idempotencyKey: "construction-preview-before" });
    const changed = readConstruction(v.constructionJson); changed[5].fields.notes = "增加背面绣花";
    await prisma.styleVersion.update({ where: { id: v.id }, data: { constructionJson: JSON.stringify(changed) } });
    await expect(confirmOrderAssistant(as, { proposalId: preview.proposalId, confirmed: true })).rejects.toThrow("资料");
    const nextPreview = await previewOrderAssistant(as, { text, candidateId: candidate.id, idempotencyKey: "construction-preview-after" });
    const order = await confirmOrderAssistant(as, { proposalId: nextPreview.proposalId, confirmed: true });
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: order.orderId }, include: { version: true } });
    expect(line.version?.constructionJson).toBe(JSON.stringify(changed));
    expect(line.version?.status).toBe("draft");
    expect((await readConstructionImage({ ...actor, styleId: created.styleId, versionId: line.version!.id, key: "craft-1" })).bytes).toEqual(png);
    const empty = await prisma.styleVersion.create({ data: { id: "construction-empty-draft", styleId: created.styleId, versionNumber: 3, status: "draft", cuffType: "常规", changeSummary: "空用料草稿", constructionJson: JSON.stringify([{ key: "own-process", group: "process", name: "印花", fields: {} }]) } });
    await prisma.orderLine.update({ where: { id: line.id }, data: { styleVersionId: empty.id } });
    await referenceApprovedMaterials({ ...actor, orderId: order.orderId });
    const copied = readConstruction((await prisma.styleVersion.findUniqueOrThrow({ where: { id: empty.id } })).constructionJson);
    expect(copied.filter(r => r.group !== "process")).toHaveLength(5);
    expect(copied.filter(r => r.group === "process").map(r => r.name)).toEqual(["印花"]);
    expect((await readConstructionImage({ ...actor, styleId: created.styleId, versionId: empty.id, key: "trim-1" })).bytes).toEqual(png);
  });

});
