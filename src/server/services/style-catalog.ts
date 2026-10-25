import type { Prisma } from "@prisma/client";
import { lockOrganizationForWrite } from "./order-write";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/hash";
import { ROLES } from "@/lib/constants";
import { writeAudit } from "@/server/services/intake";

export const STYLE_OPTION_KINDS = ["brand", "category", "type", "year"] as const;
export type StyleOptionKind = (typeof STYLE_OPTION_KINDS)[number];

export class StyleCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StyleCatalogError";
  }
}

export type StyleCatalogLeaf = { id: string; name: string };
export type StyleCatalogGroup = { id: string; name: string; children: StyleCatalogLeaf[] };
export type StyleCatalog = {
  brands: StyleCatalogLeaf[];
  categories: StyleCatalogGroup[];
  types: StyleCatalogLeaf[];
  years: StyleCatalogLeaf[];
};

export const DEFAULT_CATEGORY_TREE: Array<{ name: string; children: string[] }> = [
  { name: "针织", children: ["套头衫", "开衫", "长裤", "连衣裙", "半裙", "背心", "短袖T恤", "Polo衫", "长袖上衣"] },
  { name: "梭织", children: ["西装", "长裤", "短裤", "衬衫", "外套", "丝巾", "上衣", "连衣裙", "半裙", "背心/马甲", "连体裤", "包袋", "蝴蝶结"] },
  { name: "毛衣", children: ["套头衫", "开衫", "长裤", "连衣裙", "半裙", "帽子", "围巾", "手套", "背心", "领带", "披肩", "短裤"] },
  { name: "配饰", children: ["袜子", "帆布包", "方巾", "包袋", "护照夹", "行李挂牌", "围巾"] },
];

export const DEFAULT_STYLE_TYPES = ["内部", "外采"];
export const DEFAULT_STYLE_YEARS = ["2028", "2027", "2026", "2025", "2024", "2023", "2022", "2021"];

type Db = Pick<PrismaClient, "styleOption" | "$transaction">;

function assertCanEdit(role: string) {
  if (role === ROLES.factory) throw new StyleCatalogError("当前角色无权维护主档资料选项");
}

function assertKind(kind: string): asserts kind is StyleOptionKind {
  if (!STYLE_OPTION_KINDS.includes(kind as StyleOptionKind)) {
    throw new StyleCatalogError("不支持的资料种类");
  }
}

export function categoryOptionLabel(option: { name: string; parent?: { name: string } | null }) {
  return option.parent?.name ? `${option.parent.name} / ${option.name}` : option.name;
}

export async function seedStyleCatalog(client: Db, organizationId: string) {
  const existing = await client.styleOption.count({ where: { organizationId } });
  if (existing > 0) return;

  const rows: Array<{
    id: string;
    organizationId: string;
    kind: StyleOptionKind;
    parentId: string | null;
    name: string;
    sort: number;
  }> = [];

  DEFAULT_CATEGORY_TREE.forEach((group, groupIndex) => {
    const parentId = `opt-${organizationId}-cat-${groupIndex}`;
    rows.push({
      id: parentId,
      organizationId,
      kind: "category",
      parentId: null,
      name: group.name,
      sort: groupIndex + 1,
    });
    group.children.forEach((child, childIndex) => {
      rows.push({
        id: `${parentId}-${childIndex}`,
        organizationId,
        kind: "category",
        parentId,
        name: child,
        sort: childIndex + 1,
      });
    });
  });

  DEFAULT_STYLE_TYPES.forEach((name, index) => {
    rows.push({
      id: `opt-${organizationId}-type-${index}`,
      organizationId,
      kind: "type",
      parentId: null,
      name,
      sort: index + 1,
    });
  });

  DEFAULT_STYLE_YEARS.forEach((name, index) => {
    rows.push({
      id: `opt-${organizationId}-year-${name}`,
      organizationId,
      kind: "year",
      parentId: null,
      name,
      sort: index + 1,
    });
  });

  await client.$transaction(async (tx) => {
    if (await tx.styleOption.count({ where: { organizationId } })) return;
    await tx.styleOption.createMany({ data: rows.filter((row) => !row.parentId) });
    await tx.styleOption.createMany({ data: rows.filter((row) => row.parentId) });
  });
}

export async function listStyleCatalog(organizationId: string): Promise<StyleCatalog> {
  await seedStyleCatalog(prisma, organizationId);
  const rows = await prisma.styleOption.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: [{ kind: "asc" }, { sort: "asc" }, { name: "asc" }],
  });

  const byParent = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = byParent.get(row.parentId) ?? [];
    list.push(row);
    byParent.set(row.parentId, list);
  }

  return {
    brands: rows.filter((row) => row.kind === "brand").map((row) => ({ id: row.id, name: row.name })),
    categories: rows
      .filter((row) => row.kind === "category" && !row.parentId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        children: (byParent.get(row.id) ?? []).map((child) => ({ id: child.id, name: child.name })),
      })),
    types: rows.filter((row) => row.kind === "type").map((row) => ({ id: row.id, name: row.name })),
    years: rows.filter((row) => row.kind === "year").map((row) => ({ id: row.id, name: row.name })),
  };
}

export async function resolveStyleOption(input: {
  organizationId: string;
  optionId: string;
  kind: StyleOptionKind;
}, db: Prisma.TransactionClient = prisma) {
  const option = await db.styleOption.findFirst({
    where: { id: input.optionId, organizationId: input.organizationId, kind: input.kind, archivedAt: null },
    include: { parent: true },
  });
  if (!option) throw new StyleCatalogError("资料选项不存在或不属于当前组织");
  return option;
}

function normalizeName(kind: StyleOptionKind, raw: string) {
  const name = raw.trim();
  if (!name) throw new StyleCatalogError("请填写要加入的名称");
  if (name.length > 40) throw new StyleCatalogError("名称太长");
  if (kind === "year") {
    if (!/^\d{4}$/.test(name)) throw new StyleCatalogError("年份用四位数字，例如 2026");
    const year = Number(name);
    if (year < 2000 || year > 2040) throw new StyleCatalogError("年份超出可维护范围");
  }
  return name;
}

export async function createStyleOption(input: {
  organizationId: string;
  userId: string;
  role: string;
  kind: string;
  name: string;
  parentId?: string | null;
}) {
  assertCanEdit(input.role);
  assertKind(input.kind);
  const name = normalizeName(input.kind, input.name);
  let parentId: string | null = null;
  if (input.kind === "category" && input.parentId) {
    const parent = await resolveStyleOption({
      organizationId: input.organizationId,
      optionId: input.parentId,
      kind: "category",
    });
    if (parent.parentId) throw new StyleCatalogError("子类下面不能再分层");
    parentId = parent.id;
  } else if (input.parentId) {
    throw new StyleCatalogError("只有品类可以分层");
  }

  const exists = await prisma.styleOption.findFirst({
    where: { organizationId: input.organizationId, kind: input.kind, parentId, name },
  });
  if (exists) throw new StyleCatalogError("这个选项已经在名单里");

  const option = await prisma.styleOption.create({
    data: {
      id: createId(),
      organizationId: input.organizationId,
      kind: input.kind,
      parentId,
      name,
      sort: 1000,
    },
    include: { parent: true },
  });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style.option.created",
    entityType: "StyleOption",
    entityId: option.id,
    summary: `名单加入${kindLabel(input.kind)} ${parentId ? `${option.parent?.name} / ` : ""}${name}，可快选，不是新菜单`,
  });
  return option;
}

export async function removeStyleOption(input: {
  organizationId: string;
  userId: string;
  role: string;
  optionId: string;
}) {
  assertCanEdit(input.role);
  const option = await prisma.styleOption.findFirst({
    where: { id: input.optionId, organizationId: input.organizationId },
    include: {
      children: true,
      _count: { select: { brandStyles: true, categoryStyles: true, typeStyles: true, yearStyles: true } },
    },
  });
  if (!option) throw new StyleCatalogError("资料选项不存在或不属于当前组织");
  if (option.children.length) throw new StyleCatalogError("先把下面的子类撤下");
  const used =
    option._count.brandStyles + option._count.categoryStyles + option._count.typeStyles + option._count.yearStyles;
  if (used > 0) throw new StyleCatalogError("还有款式挂着这个选项，先从款上撤下");
  await prisma.styleOption.delete({ where: { id: option.id } });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style.option.removed",
    entityType: "StyleOption",
    entityId: option.id,
    summary: `名单移除${kindLabel(option.kind)} ${option.name}，未删除款式主档`,
  });
  return { removed: true, name: option.name };
}

export async function assignStyleCatalog(input: {
  organizationId: string;
  userId: string;
  role: string;
  styleId: string;
  brandOptionId?: string | null;
  categoryOptionId?: string | null;
  typeOptionId?: string | null;
  yearOptionId?: string | null;
}) {
  assertCanEdit(input.role);
  return prisma.$transaction(async db => {
  await lockOrganizationForWrite(db, input.organizationId);
  if (!await db.user.findFirst({ where: { id: input.userId, organizationId: input.organizationId, role: input.role, active: true } })) throw new StyleCatalogError("无权修改主档");
  const style = await db.style.findFirst({
    where: { id: input.styleId, organizationId: input.organizationId },
  });
  if (!style) throw new StyleCatalogError("款式不存在或不属于当前组织");

  const data: {
    brandOptionId?: string | null;
    categoryOptionId?: string | null;
    typeOptionId?: string | null;
    yearOptionId?: string | null;
    category?: string;
  } = {};

  if ("brandOptionId" in input) {
    data.brandOptionId = input.brandOptionId
      ? (await resolveStyleOption({ organizationId: input.organizationId, optionId: input.brandOptionId, kind: "brand" }, db)).id
      : null;
  }
  if ("categoryOptionId" in input) {
    if (input.categoryOptionId) {
      const category = await resolveStyleOption({
        organizationId: input.organizationId,
        optionId: input.categoryOptionId,
        kind: "category",
      }, db);
      data.categoryOptionId = category.id;
      data.category = categoryOptionLabel(category);
    } else {
      data.categoryOptionId = null;
    }
  }
  if ("typeOptionId" in input) {
    data.typeOptionId = input.typeOptionId
      ? (await resolveStyleOption({ organizationId: input.organizationId, optionId: input.typeOptionId, kind: "type" }, db)).id
      : null;
  }
  if ("yearOptionId" in input) {
    data.yearOptionId = input.yearOptionId
      ? (await resolveStyleOption({ organizationId: input.organizationId, optionId: input.yearOptionId, kind: "year" }, db)).id
      : null;
  }

  await db.style.update({ where: { id: style.id }, data });
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "style.catalog.assigned",
    entityType: "Style",
    entityId: style.id,
    summary: `更新 ${style.code} 主档资料选项，年份不是新款号`,
    payloadJson: JSON.stringify({ before: style, after: { ...style, ...data }, basis: "负责人修改主档选项，历史订单与版本保留" }),
  }, db);
  return { ok: true };
  });
}

function kindLabel(kind: string) {
  if (kind === "brand") return "品牌";
  if (kind === "category") return "品类";
  if (kind === "type") return "类型";
  if (kind === "year") return "年份";
  return kind;
}
