import { ACTION_TYPES } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { canApproveAction } from "@/server/permissions";
import { ExecutionError } from "@/server/services/execution";

export type OralColorInput = { colorName: string; quantity: number };

export const BUILTIN_FILL_COLORS = ["海军蓝", "灰色", "黑色", "白色", "红色", "本色"] as const;

export type FillColorOption = { name: string; source: "style" | "org" | "builtin" };
export type FillMaterialOption = {
  id: string;
  code: string;
  name: string;
  kind: string;
  source: "bom" | "org";
};
export type StyleFillPack = {
  styleId: string;
  colors: FillColorOption[];
  materials: FillMaterialOption[];
};

function mergeFillMaterials(
  bomMaterials: Array<{ id: string; code: string; name: string; kind: string }>,
  orgMaterials: Array<{ id: string; code: string; name: string; kind: string }>,
): FillMaterialOption[] {
  const materials: FillMaterialOption[] = [];
  const seen = new Set<string>();
  for (const material of bomMaterials) {
    if (seen.has(material.id)) continue;
    seen.add(material.id);
    materials.push({ ...material, source: "bom" });
  }
  for (const material of orgMaterials) {
    if (seen.has(material.id)) continue;
    seen.add(material.id);
    materials.push({ ...material, source: "org" });
  }
  return materials;
}

function mergeFillColors(styleNames: string[], orgNames: string[] = []): FillColorOption[] {
  const colors: FillColorOption[] = [];
  const seen = new Set<string>();
  for (const raw of styleNames) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    colors.push({ name, source: "style" });
  }
  for (const name of BUILTIN_FILL_COLORS) {
    if (seen.has(name)) continue;
    seen.add(name);
    colors.push({ name, source: "builtin" });
  }
  for (const raw of orgNames) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    colors.push({ name, source: "org" });
  }
  return colors;
}

export async function listStyleFillPack(organizationId: string, styleId: string): Promise<StyleFillPack> {
  const style = await prisma.style.findFirst({
    where: { id: styleId, organizationId },
    select: { id: true },
  });
  if (!style) return { styleId, colors: [], materials: [] };

  const [styleColorRows, orgColorRows, approved, orgMaterials] = await Promise.all([
    prisma.orderColorQty.findMany({
      where: { line: { styleId, order: { organizationId } } },
      select: { colorName: true },
    }),
    prisma.orderColorQty.findMany({
      where: { line: { order: { organizationId } } },
      select: { colorName: true },
    }),
    prisma.styleVersion.findFirst({
      where: { styleId, status: "approved" },
      orderBy: { versionNumber: "desc" },
      include: { bomLines: { include: { material: true } } },
    }),
    prisma.material.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, kind: true },
    }),
  ]);

  const materials = mergeFillMaterials(
    (approved?.bomLines ?? []).map((line) => line.material),
    orgMaterials,
  );

  return {
    styleId,
    colors: mergeFillColors(
      styleColorRows.map((row) => row.colorName),
      orgColorRows.map((row) => row.colorName),
    ),
    materials,
  };
}

export async function listOrgFillCatalog(organizationId: string): Promise<{
  packs: Record<string, StyleFillPack>;
  colors: FillColorOption[];
  materials: FillMaterialOption[];
}> {
  const [styles, colorRows, approvedBoms, orgMaterials] = await Promise.all([
    prisma.style.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true },
      orderBy: { code: "asc" },
    }),
    prisma.orderColorQty.findMany({
      where: { line: { order: { organizationId } } },
      select: { colorName: true, line: { select: { styleId: true } } },
    }),
    prisma.bomLine.findMany({
      where: { version: { status: "approved", style: { organizationId } } },
      include: { material: true, version: { select: { styleId: true, versionNumber: true } } },
    }),
    prisma.material.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, kind: true },
    }),
  ]);

  const colorsByStyle = new Map<string, string[]>();
  const orgColorNames: string[] = [];
  for (const row of colorRows) {
    orgColorNames.push(row.colorName);
    const list = colorsByStyle.get(row.line.styleId) ?? [];
    list.push(row.colorName);
    colorsByStyle.set(row.line.styleId, list);
  }

  const versionRank = new Map<string, number>();
  const bomByStyle = new Map<string, FillMaterialOption["id"][]>();
  const bomMaterials = new Map<string, FillMaterialOption>();
  for (const line of approvedBoms) {
    const styleId = line.version.styleId;
    const rank = line.version.versionNumber;
    const current = versionRank.get(styleId) ?? -1;
    if (rank < current) continue;
    if (rank > current) {
      versionRank.set(styleId, rank);
      bomByStyle.set(styleId, []);
    }
    const option: FillMaterialOption = {
      id: line.material.id,
      code: line.material.code,
      name: line.material.name,
      kind: line.material.kind,
      source: "bom",
    };
    bomMaterials.set(`${styleId}:${option.id}`, option);
    const ids = bomByStyle.get(styleId) ?? [];
    if (!ids.includes(option.id)) ids.push(option.id);
    bomByStyle.set(styleId, ids);
  }

  const packs: Record<string, StyleFillPack> = {};
  for (const style of styles) {
    const bom = (bomByStyle.get(style.id) ?? [])
      .map((id) => bomMaterials.get(`${style.id}:${id}`))
      .filter((item): item is FillMaterialOption => Boolean(item));
    packs[style.id] = {
      styleId: style.id,
      colors: mergeFillColors(colorsByStyle.get(style.id) ?? [], orgColorNames),
      materials: mergeFillMaterials(bom, orgMaterials),
    };
  }

  return {
    packs,
    colors: mergeFillColors([], orgColorNames),
    materials: mergeFillMaterials([], orgMaterials),
  };
}

export function normalizeOralColors(colors: OralColorInput[]) {
  const merged = new Map<string, number>();
  for (const row of colors) {
    const colorName = String(row.colorName ?? "").trim();
    const quantity = Number(row.quantity);
    if (!colorName && (row.quantity === 0 || row.quantity == null || String(row.quantity).trim() === "")) continue;
    if (!colorName) throw new ExecutionError("颜色名称不能为空");
    if (!Number.isInteger(quantity) || quantity <= 0) throw new ExecutionError("件数必须是大于 0 的整数");
    merged.set(colorName, (merged.get(colorName) ?? 0) + quantity);
  }
  return [...merged.entries()].map(([colorName, quantity]) => ({ colorName, quantity }));
}

export async function createOralOrderDraft(input: {
  organizationId: string;
  userId: string;
  role: string;
  customerId: string;
  styleId: string;
  factoryId?: string | null;
  colors: OralColorInput[];
  externalCustomerPo?: string | null;
  deliveryText?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
}) {
  if (!canApproveAction(input.role, ACTION_TYPES.createOrderDraft)) {
    throw new ExecutionError("当前角色无权创建订单草稿");
  }
  const colors = normalizeOralColors(input.colors);
  if (!colors.length) throw new ExecutionError("至少填写一种颜色和件数");
  const totalQuantity = colors.reduce((sum, color) => sum + color.quantity, 0);
  const po = String(input.externalCustomerPo ?? "").trim() || null;
  const deliveryText = String(input.deliveryText ?? "").trim() || null;
  const note = String(input.note ?? "").trim() || null;
  const idempotencyKey = String(input.idempotencyKey ?? "").trim() || createId();
  const contentHash = sha256(`oral-order:${input.organizationId}:${idempotencyKey}`);

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId, archivedAt: null },
    });
    if (!customer) throw new ExecutionError("客户不存在或不属于当前组织");
    const style = await tx.style.findFirst({
      where: { id: input.styleId, organizationId: input.organizationId, archivedAt: null },
    });
    if (!style) throw new ExecutionError("款式不存在或不属于当前组织");
    let factoryId: string | null = null;
    if (input.factoryId) {
      const factory = await tx.party.findFirst({
        where: { id: input.factoryId, organizationId: input.organizationId, kind: "factory", archivedAt: null },
      });
      if (!factory) throw new ExecutionError("工厂不存在或不属于当前组织");
      factoryId = factory.id;
    }

    const existingSource = await tx.sourceDocument.findFirst({
      where: { organizationId: input.organizationId, contentHash },
    });
    if (existingSource) {
      const existingOrder = await tx.salesOrder.findFirst({
        where: { organizationId: input.organizationId, sourceDocumentId: existingSource.id },
      });
      if (existingOrder) {
        const styleCount = await tx.style.count({ where: { organizationId: input.organizationId } });
        return {
          orderId: existingOrder.id,
          orderNo: existingOrder.orderNo,
          reused: true,
          styleCountBefore: styleCount,
          styleCountAfter: styleCount,
        };
      }
    }

    const template =
      (await tx.styleVersion.findFirst({
        where: { styleId: style.id, status: "approved" },
        orderBy: { versionNumber: "desc" },
      })) ??
      (await tx.styleVersion.findFirst({
        where: { styleId: style.id },
        orderBy: { versionNumber: "desc" },
      }));
    if (!template) throw new ExecutionError("该款还没有资料版本，无法建单");

    const styleCountBefore = await tx.style.count({ where: { organizationId: input.organizationId } });
    const source =
      existingSource ??
      (await tx.sourceDocument.create({
        data: {
          id: createId(),
          organizationId: input.organizationId,
          contentHash,
          origin: "oral-order",
          mimeType: "text/plain",
          rawText: [
            `口头建单`,
            `客户 ${customer.name}`,
            `款号 ${style.code} ${style.name}`,
            `PO ${po ?? "空"}`,
            `交期 ${deliveryText ?? "未写"}`,
            `颜色 ${colors.map((color) => `${color.colorName} ${color.quantity}`).join("、")}`,
            note ? `备注 ${note}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          receivedAt: new Date(),
          parseStatus: "succeeded",
        },
      }));

    const latestVersion = await tx.styleVersion.findFirst({
      where: { styleId: style.id },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionDraft = await tx.styleVersion.create({
      data: {
        id: createId(),
        styleId: style.id,
        versionNumber: (latestVersion?.versionNumber ?? template.versionNumber) + 1,
        status: "draft",
        cuffType: template.cuffType,
        constructionJson: template.constructionJson,
        changeSummary: "口头建单对照已有资料创建本单草稿，未覆盖已批准版本",
        sourceDocumentId: source.id,
      },
    });
    const templateBom = await tx.bomLine.findMany({ where: { styleVersionId: template.id } });
    if (templateBom.length) {
      await tx.bomLine.createMany({
        data: templateBom.map((line) => ({
          id: createId(),
          styleVersionId: versionDraft.id,
          materialId: line.materialId,
          consumption: line.consumption,
          unit: line.unit,
          includesAllowance: line.includesAllowance,
          allowanceRate: line.allowanceRate,
          colorScope: line.colorScope,
          confirmed: false,
        })),
      });
    }

    const orderCount = await tx.salesOrder.count({ where: { organizationId: input.organizationId } });
    const orderNo = `DEMO-ORD-${String(orderCount + 1).padStart(3, "0")}`;
    const order = await tx.salesOrder.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        orderNo,
        customerId: customer.id,
        factoryId,
        status: "draft",
        productionReadiness: "blocked_incomplete_spec",
        externalCustomerPo: po,
        requestedDeliveryText: deliveryText,
        requestedDeliveryDate: null,
        sourceDocumentId: source.id,
        createdByUserId: input.userId,
        notes: `口头单草稿：不是邮件翻单，缺少尺码配比，不能投产${note ? `。${note}` : ""}`,
        lines: {
          create: {
            id: createId(),
            styleId: style.id,
            styleVersionId: versionDraft.id,
            totalQuantity,
            colors: {
              create: colors.map((color) => ({
                id: createId(),
                colorName: color.colorName,
                quantity: color.quantity,
              })),
            },
          },
        },
      },
    });

    await tx.taskItem.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        title: "补齐各尺码数量",
        kind: "missing_size_breakdown",
        status: "open",
        blocking: true,
        assigneeRole: "salesperson",
        relatedOrderId: order.id,
        relatedStyleId: style.id,
        sourceDocumentId: source.id,
        note: "口头建单后必须在订单页补色尺，不能投产",
      },
    });

    await tx.auditEvent.create({
      data: {
        id: createId(),
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorType: "user",
        action: "order.oral_draft_created",
        entityType: "SalesOrder",
        entityId: order.id,
        summary: `口头建单 ${orderNo}，沿用 ${style.code}，未复制款式主档，未投产`,
        payloadJson: JSON.stringify({
          orderId: order.id,
          orderNo,
          styleId: style.id,
          customerId: customer.id,
          totalQuantity,
          po,
        }),
      },
    });

    return {
      orderId: order.id,
      orderNo,
      reused: false,
      styleCountBefore,
      styleCountAfter: await tx.style.count({ where: { organizationId: input.organizationId } }),
    };
  });
}
