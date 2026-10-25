import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { lockOrganizationForWrite } from "./order-write";
import { ExecutionError } from "./execution";
export const CatalogKind = z.enum(["style", "material", "customer", "factory", "supplier", "brand", "project", "follow", "order"]);
export type CatalogKind = z.infer<typeof CatalogKind>;
const TABLES = { style: "Style", material: "Material", customer: "Customer", factory: "Party", supplier: "Party", brand: "StyleOption", project: "DevelopmentProject", follow: "OrderMerchSheet", order: "SalesOrder" } as const;
export const CATALOG_NAMES: Record<CatalogKind, string> = { style: "款式", material: "材料", customer: "客户", factory: "工厂", supplier: "供应商", brand: "品牌", project: "开发版单", follow: "跟单", order: "生产订单" };
type Actor = { organizationId: string; userId: string; role: string };
type CatalogRow = { id: string; code: string; name: string; archivedAt: Date | null };
async function authorize(db: Prisma.TransactionClient, a: Actor) {
  const user = await db.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true } });
  if (!user || user.role !== a.role || !["salesperson", "manager"].includes(user.role)) throw new ExecutionError("当前账号无权维护业务资料");
}
const column = (name: string) => Prisma.raw(`"${name}"`);
const extraWhere = (kind: CatalogKind) => ["factory", "supplier"].includes(kind) ? Prisma.sql`AND kind=${kind}` : kind === "brand" ? Prisma.sql`AND kind='brand'` : Prisma.empty;
function projection(kind: CatalogKind) { return kind === "brand" ? Prisma.sql`id,'' AS code,name,archivedAt` : kind === "follow" ? Prisma.sql`id,seasonCode AS code,title AS name,archivedAt` : kind === "order" ? Prisma.sql`id,orderNo AS code,COALESCE(externalCustomerPo,'') AS name,archivedAt` : Prisma.sql`id,code,name,archivedAt`; }
export const catalogStamp = (r: CatalogRow) => sha256(JSON.stringify([r.id, r.code, r.name, r.archivedAt]));
export async function listCatalog(a: Actor, kind: CatalogKind, query = "", archived = false) {
  await authorize(prisma, a);
  const rows = await prisma.$queryRaw<CatalogRow[]>(Prisma.sql`SELECT ${projection(kind)} FROM ${column(TABLES[kind])} WHERE organizationId=${a.organizationId} ${extraWhere(kind)} AND ${archived ? Prisma.sql`archivedAt IS NOT NULL` : Prisma.sql`archivedAt IS NULL`} ORDER BY name,id`);
  const q = query.trim().toLowerCase();
  return rows.filter(r => !q || `${r.code} ${r.name}`.toLowerCase().includes(q)).map(r => ({ ...r, archivedAt: r.archivedAt ? new Date(r.archivedAt).toISOString() : null, stamp: catalogStamp(r), href: kind === "style" ? `/styles/${r.id}` : kind === "project" ? `/projects/${r.id}` : kind === "follow" ? `/orders/follow/${r.id}` : kind === "order" ? `/orders/${r.id}` : kind === "material" ? `/resources/materials/${r.id}` : kind === "customer" ? `/resources/customers/${r.id}` : kind === "brand" ? "/styles" : `/resources/parties/${r.id}` }));
}
async function references(db: Prisma.TransactionClient, kind: CatalogKind, id: string, code: string, org: string) {
  let count = 0;
  if (kind === "material") count += await db.workflowRevision.count({ where: { stage: { organizationId: org }, constructionJson: { contains: `"materialId":${JSON.stringify(id)}` } } });
  for (const table of Prisma.dmmf.datamodel.models) {
    if (["AuditEvent", "StyleCodeAlias"].includes(table.name) || kind === "style" && ["StyleVersion", "StyleSeason"].includes(table.name)) continue;
    const keys = table.fields.filter(f => f.kind === "scalar" && f.type === "String" && f.name !== "id" && /Id$/.test(f.name));
    if (!keys.length) continue;
    const result = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n FROM ${column(table.dbName ?? table.name)} WHERE ${Prisma.join(keys.map(f => Prisma.sql`${column(f.dbName ?? f.name)}=${id}`), " OR ")}`);
    count += Number(result[0].n);
  }
  // These legacy references are scalar identifiers, not Prisma relations.
  const extras: Array<[string, string[]]> = kind === "factory" || kind === "supplier" ? [["PatternSample", ["factoryId"]], ["FactoryTransfer", ["fromFactoryId", "toFactoryId"]], ["OrderMerchSheet", ["factoryId"]]] : kind === "customer" ? [["DevelopmentProject", ["customerId"]], ["OrderMerchSheet", ["customerId"]]] : kind === "style" ? [["StyleCodeAlias", ["styleId"]]] : kind === "order" ? [["FactoryTransfer", ["orderId", "newOrderId"]]] : [];
  for (const [table, cols] of extras) for (const col of cols) { const r = await db.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT COUNT(*) n FROM ${column(table)} WHERE ${column(col)}=${id}`); if (table !== "StyleCodeAlias") count += Number(r[0].n); }
  if (kind === "style") {
    const aliases = await db.styleCodeAlias.findMany({ where: { organizationId: org, styleId: id } });
    count += await db.orderMerchStyle.count({ where: { sheet: { organizationId: org }, styleCode: { in: [code, ...aliases.map(a => a.code)] } } });
    const versions = await db.styleVersion.findMany({ where: { styleId: id }, include: { _count: { select: { bomLines: true, attachments: true, orderLines: true } } } });
    count += versions.filter(v => v.status !== "draft" || v.specNotes || v.processNotes || v.patternRevision || v.sourceDocumentId || Object.values(v._count).some(Boolean)).length;
  }
  count += await db.actionProposal.count({ where: { organizationId: org, status: { in: ["preview", "executed"] }, payloadJson: { contains: id } } });
  return count;
}
export const CatalogCommand = z.object({ kind: CatalogKind, action: z.enum(["create", "update", "archive", "restore", "delete"]), id: z.string().max(100).optional(), expectedStamp: z.string().max(100).optional(), code: z.string().trim().max(100).optional(), name: z.string().trim().max(200).optional(), reason: z.string().trim().min(1).max(2000), confirmedName: z.string().max(200).optional() }).strict();
export async function maintainCatalog(a: Actor, raw: z.infer<typeof CatalogCommand>) {
  const input = CatalogCommand.parse(raw), kind = input.kind;
  return prisma.$transaction(async db => {
    await lockOrganizationForWrite(db, a.organizationId); await authorize(db, a);
    if (input.action === "create") {
      if (!["customer", "factory", "supplier", "brand"].includes(kind) || !input.name) throw new ExecutionError("请选择客户、工厂、供应商或品牌，并填写名称；款式和材料沿用原建档入口");
      const id = createId(), name = input.name, code = input.code || `${kind.slice(0, 3).toUpperCase()}-${id.replaceAll("-", "").slice(0, 10)}`;
      const same = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${column(TABLES[kind])} WHERE organizationId=${a.organizationId} ${extraWhere(kind)} AND name=${name}`);
      if (same.length) throw new ExecutionError("已有同名资料（含归档），请核对原记录或恢复使用");
      if (kind === "brand") await db.styleOption.create({ data: { id, organizationId: a.organizationId, kind, name } });
      else if (kind === "customer") await db.customer.create({ data: { id, organizationId: a.organizationId, code, name, demoNote: "" } });
      else await db.party.create({ data: { id, organizationId: a.organizationId, code, name, kind, demoNote: "" } });
      await audit(db, a, kind, id, "created", null, { code: kind === "brand" ? "" : code, name }, input.reason);
      return { id, message: `已新建${CATALOG_NAMES[kind]}，可回业务页面选择` };
    }
    if (!input.id) throw new ExecutionError("请选择原记录");
    const rows = await db.$queryRaw<CatalogRow[]>(Prisma.sql`SELECT ${projection(kind)} FROM ${column(TABLES[kind])} WHERE id=${input.id} AND organizationId=${a.organizationId} ${extraWhere(kind)}`);
    const row = rows[0]; if (!row) throw new ExecutionError("记录不存在或不属于本公司");
    if (input.expectedStamp !== catalogStamp(row)) throw new ExecutionError("资料已变化，请刷新核对后重新提交");
    if (input.action === "delete") {
      if (["order", "follow", "project"].includes(kind)) throw new ExecutionError("业务单据保留历史，请使用归档；不能删除执行或版次记录");
      if (input.confirmedName !== row.name) throw new ExecutionError("请输入完整名称确认删除");
      if (await references(db, kind, row.id, row.code, a.organizationId)) throw new ExecutionError("已有业务引用、版本或凭证，不能删除；可归档，历史入口仍保留");
      if (kind === "style") { await db.styleVersion.deleteMany({ where: { styleId: row.id } }); await db.styleSeason.deleteMany({ where: { styleId: row.id } }); await db.styleCodeAlias.deleteMany({ where: { styleId: row.id, organizationId: a.organizationId } }); }
      await db.$executeRaw(Prisma.sql`DELETE FROM ${column(TABLES[kind])} WHERE id=${row.id} AND organizationId=${a.organizationId}`);
      await audit(db, a, kind, row.id, "deleted", row, null, input.reason);
      return { id: row.id, message: "已删除未被业务使用的资料，删除依据已留档" };
    }
    if (input.action === "archive" || input.action === "restore") {
      if (input.action === "archive" && kind === "order") {
        const order = await db.salesOrder.findUniqueOrThrow({ where: { id: row.id }, include: { tasks: { where: { status: "open" } } } });
        if (!(["completed", "closed", "cancelled"].includes(order.status) || order.productionReadiness === "shipped") || order.tasks.length) throw new ExecutionError("生产订单尚未结束或仍有待办，先处理业务再归档");
      }
      if (input.action === "archive" && kind === "follow") {
        const pending = await db.orderMerchStyle.count({ where: { sheetId: row.id, productionLineId: null } });
        if (pending) throw new ExecutionError("跟单仍有未转生产的款，请先处理，避免归档后遗漏");
      }
      if (input.action === "archive" && kind === "project") {
        const samples = await db.patternSample.findMany({ where: { projectId: row.id } });
        if (samples.some(s => !JSON.parse(s.feedbackJson || "{}").returnedOn)) throw new ExecutionError("仍有未回样的打样任务，先完成或处理任务再归档");
      }
      const at = input.action === "archive" ? new Date() : null;
      await db.$executeRaw(Prisma.sql`UPDATE ${column(TABLES[kind])} SET archivedAt=${at} WHERE id=${row.id} AND organizationId=${a.organizationId}`);
      await audit(db, a, kind, row.id, input.action, row, { ...row, archivedAt: at }, input.reason);
      return { id: row.id, message: at ? "已归档，退出日常列表；业务历史和凭证仍可查" : "已恢复到日常列表" };
    }
    if (["order", "follow", "project"].includes(kind)) throw new ExecutionError("请回原业务单据修改，不能从基础资料覆盖单据");
    const name = input.name || row.name, code = kind === "brand" ? "" : input.code || row.code;
    if (name !== row.name) {
      const duplicate = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${column(TABLES[kind])} WHERE organizationId=${a.organizationId} AND id<>${row.id} ${extraWhere(kind)} AND name=${name}`);
      if (duplicate.length) throw new ExecutionError("已有同名记录，请核对，不能在这里合并业务伙伴");
    }
    if (code !== row.code) {
      if (kind === "style") {
        if (await db.style.findFirst({ where: { organizationId: a.organizationId, id: { not: row.id }, code } }) || await db.styleCodeAlias.findFirst({ where: { organizationId: a.organizationId, styleId: { not: row.id }, code } })) throw new ExecutionError("款号已被其他款式或其旧款号使用");
        await db.styleCodeAlias.upsert({ where: { organizationId_code: { organizationId: a.organizationId, code: row.code } }, create: { id: createId(), organizationId: a.organizationId, styleId: row.id, code: row.code }, update: {} });
      } else if (await references(db, kind, row.id, row.code, a.organizationId)) throw new ExecutionError("已被业务使用的伙伴或材料编码保留，名称可以修正；不能将原资料变成另一个对象");
    }
    if (kind === "brand") await db.styleOption.update({ where: { id: row.id }, data: { name } });
    else await db.$executeRaw(Prisma.sql`UPDATE ${column(TABLES[kind])} SET code=${code},name=${name} WHERE id=${row.id} AND organizationId=${a.organizationId}`);
    await audit(db, a, kind, row.id, "updated", row, { ...row, code, name }, input.reason);
    return { id: row.id, message: "已保存；原业务记录保留，款式旧款号仍可追溯" };
  });
}
async function audit(db: Prisma.TransactionClient, a: Actor, kind: CatalogKind, id: string, action: string, before: unknown, after: unknown, basis: string) {
  await db.auditEvent.create({ data: { id: createId(), organizationId: a.organizationId, actorType: "user", actorUserId: a.userId, entityType: TABLES[kind], entityId: id, action: `catalog.${action}`, summary: `${CATALOG_NAMES[kind]}${action === "updated" ? "修订" : action}：${basis}`, payloadJson: JSON.stringify({ before, after, basis }) } });
}
