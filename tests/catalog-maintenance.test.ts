import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { listCatalog, maintainCatalog } from "@/server/services/catalog-maintenance";
import { createStyleMaster } from "@/server/services/style-create";
import { listStyleSummaries } from "@/server/services/style-thread";
import { resolveStyleCodes } from "@/server/services/style-code";
import { searchBusiness } from "@/server/services/business-search";
import { resetDatabase } from "./helpers";
const a = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
beforeEach(resetDatabase);
describe("可维护主档，业务历史不丢", () => {
  it("客户、工厂、供应商、品牌可建档修名归档恢复，写入前后及操作者可查", async () => {
    for (const kind of ["customer", "factory", "supplier", "brand"] as const) {
      const c = await maintainCatalog(a, { kind, action: "create", name: `新${kind}`, reason: "核对新合作对象" });
      let row = (await listCatalog(a, kind)).find(r => r.id === c.id)!;
      await maintainCatalog(a, { kind, id: c.id, action: "update", name: `修正${kind}`, expectedStamp: row.stamp, reason: "按对方正式名称修正" });
      row = (await listCatalog(a, kind)).find(r => r.id === c.id)!;
      await maintainCatalog(a, { kind, id: c.id, action: "archive", expectedStamp: row.stamp, reason: "暂停新业务" });
      expect((await listCatalog(a, kind)).some(r => r.id === c.id)).toBe(false);
      row = (await listCatalog(a, kind, "", true)).find(r => r.id === c.id)!;
      await maintainCatalog(a, { kind, id: c.id, action: "restore", expectedStamp: row.stamp, reason: "恢复合作" });
      expect((await listCatalog(a, kind)).some(r => r.id === c.id)).toBe(true);
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: c.id, action: "catalog.updated" } });
      expect(audit.actorUserId).toBe(a.userId); expect(JSON.parse(audit.payloadJson!).before.name).toBe(`新${kind}`); expect(JSON.parse(audit.payloadJson!).after.name).toBe(`修正${kind}`);
    }
  });
  it("款式改名改号保留旧号检索和原订单关系，旧号不能另建新款", async () => {
    const before = await prisma.orderLine.findMany({ where: { styleId: IDS.styleSt26018 } });
    const row = (await listCatalog(a, "style")).find(r => r.id === IDS.styleSt26018)!;
    await maintainCatalog(a, { kind: "style", id: row.id, action: "update", name: "圆领卫衣修正品名", code: "ST-NEW-18", expectedStamp: row.stamp, reason: "客户修正款号" });
    expect((await resolveStyleCodes(prisma, a.organizationId, ["ST-26018", "ST-NEW-18"])).get("ST-26018")?.id).toBe(row.id);
    const results = await searchBusiness(a, "ST-26018", { kind: "style" }); expect(results.items.some(r => r.id === row.id)).toBe(true);
    expect(await prisma.orderLine.findMany({ where: { styleId: row.id } })).toEqual(before);
    await expect(createStyleMaster({ ...a, code: "ST-26018", name: "不得重复" })).rejects.toThrow(/旧款号/);
    const fresh = (await listCatalog(a, "style")).find(r => r.id === row.id)!;
    await maintainCatalog(a, { kind: "style", id: row.id, action: "archive", expectedStamp: fresh.stamp, reason: "退出日常款式列表" });
    expect((await listStyleSummaries(a.organizationId)).some(s => s.id === row.id)).toBe(false);
    expect(await prisma.orderLine.count({ where: { styleId: row.id } })).toBe(before.length);
  });
  it("只能删除未引用资料，已使用的款和伙伴保留；跨组织、伪角色和过期修改拒绝", async () => {
    const style = (await listCatalog(a, "style")).find(r => r.id === IDS.styleSt26018)!;
    await expect(maintainCatalog(a, { kind: "style", action: "delete", id: style.id, expectedStamp: style.stamp, reason: "测试", confirmedName: style.name })).rejects.toThrow(/业务引用/);
    const created = await maintainCatalog(a, { kind: "supplier", action: "create", name: "误建供应商", reason: "隔离测试" });
    const row = (await listCatalog(a, "supplier")).find(r => r.id === created.id)!;
    const cmd = { kind: "supplier" as const, action: "delete" as const, id: row.id, expectedStamp: row.stamp, reason: "误建且未使用", confirmedName: row.name };
    await expect(maintainCatalog({ ...a, organizationId: IDS.orgIso }, cmd)).rejects.toThrow(/无权/);
    await expect(maintainCatalog({ ...a, role: "manager" }, cmd)).rejects.toThrow(/无权/);
    await expect(maintainCatalog(a, { ...cmd, expectedStamp: "old" })).rejects.toThrow(/已变化/);
    await maintainCatalog(a, cmd); expect(await prisma.party.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityId: row.id, action: "catalog.deleted" } })).toBe(1);
  });
});
