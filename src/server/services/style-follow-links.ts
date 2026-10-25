import { prisma } from "@/lib/db";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { customerPo } from "@/server/domain/follow-po";
import { resolveStyleCodes } from "./style-code";

export type StyleFollowLink = { id: string; title: string; po: string; href: string; seasonCode: string; kindLabel: string; factoryId: string | null; factoryName: string; productionOrderId: string | null; productionLinkPending: boolean };

/** Keep each batch distinct, including drafts and historic style-code aliases. */
export async function listStyleFollowLinks(organizationId: string, viewer: { role?: string; factoryId?: string | null } = {}) {
  const sheets = await prisma.orderMerchSheet.findMany({
    where: { organizationId, archivedAt: null, ...(viewer.role === "factory" ? { factoryId: viewer.factoryId || "__none__" } : {}) },
    include: { styles: { orderBy: { sort: "asc" }, include: { productionLine: { select: { styleId: true, orderId: true, order: { select: { factory: { select: { id: true, name: true } } } } } } } }, order: { select: { factory: { select: { id: true, name: true } }, lines: { select: { style: { select: { id: true, code: true, name: true } } } } } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = sheets.map(sheet => ({ sheet, styles: readStoredMerchStyles(sheet, { styleCode: sheet.order?.lines[0]?.style.code ?? "", styleName: sheet.order?.lines[0]?.style.name ?? "" }) }));
  const masters = await resolveStyleCodes(prisma, organizationId, [...new Set(rows.flatMap(row => row.styles.map(style => style.styleCode)))]);
  const result = new Map<string, StyleFollowLink[]>();
  for (const { sheet, styles } of rows) for (const [index, style] of styles.entries()) {
    const line = sheet.styles.find(row => row.id === style.rowId)?.productionLine;
    const id = line?.styleId ?? masters.get(style.styleCode)?.id;
    if (!id) continue;
    result.set(id, [...(result.get(id) ?? []), {
      id: `${sheet.id}:${index}`, title: sheet.title || "跟单", po: customerPo(style, sheet.kind),
      href: `/orders/follow/${sheet.id}?row=${index}#${sheet.kind === "bulk" ? "follow-batch" : "follow-product"}`,
      seasonCode: sheet.seasonCode, kindLabel: sheet.kind === "sales_sample" ? "销售样" : "大货",
      factoryId: line?.order.factory?.id ?? (sheet.factoryName ? sheet.factoryId : sheet.order?.factory?.id ?? null),
      factoryName: line?.order.factory?.name || sheet.factoryName || sheet.order?.factory?.name || style.salesSample.factoryName,
      productionOrderId: line?.orderId ?? null,
      productionLinkPending: Boolean(sheet.salesOrderId && !line),
    }]);
  }
  return result;
}
