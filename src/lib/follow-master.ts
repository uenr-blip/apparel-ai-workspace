import type { FollowStyleLine } from "@/server/services/order-merch";

export const MASTER_COLUMNS = { materials: "面料 / 规格", labels: "主唛 / 每色唛标 / 吊牌", trims: "其他辅料 / 工艺", progress: "生产与跟单进度" } as const;
export type MasterColumn = keyof typeof MASTER_COLUMNS;
export const standardMasterColumns = Object.keys(MASTER_COLUMNS) as MasterColumn[];
export function parseMasterColumns(value: string | null | undefined): MasterColumn[] {
  if (value == null) return standardMasterColumns;
  return standardMasterColumns.filter(key => value.split(",").includes(key));
}
export function masterCounts(lines: FollowStyleLine[]) {
  let quantity = 0, missingQuantity = 0, colorRows = 0;
  for (const line of lines) for (const color of line.colors) {
    if (/下不|不下/.test(color.qtyText)) continue;
    colorRows++;
    if (/^\d{1,7}$/.test(color.qtyText.trim())) quantity += Number(color.qtyText);
    else missingQuantity++;
  }
  return { products: new Set(lines.map(line => line.numericCode || line.styleCode || line.key)).size,
    pos: new Set(lines.map(line => line.po).filter(Boolean)).size, quantity, missingQuantity, colorRows };
}
