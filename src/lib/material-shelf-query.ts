import { buildCatalogHref } from "@/lib/catalog-query";

export const MATERIAL_KIND_ORDER = ["fabric", "yarn", "trim"] as const;
export type MaterialKind = (typeof MATERIAL_KIND_ORDER)[number];
export type MaterialLayout = "list" | "cards";
export type MaterialUsedFilter = "" | "used" | "free";

export const MATERIAL_KIND_LABEL: Record<MaterialKind, string> = {
  fabric: "面料",
  yarn: "纱线",
  trim: "辅料",
};

export function parseMaterialKind(raw?: string): MaterialKind | "" {
  return MATERIAL_KIND_ORDER.includes(raw as MaterialKind) ? (raw as MaterialKind) : "";
}

export function parseMaterialLayout(raw?: string): MaterialLayout {
  return raw === "list" ? "list" : "cards";
}

export function parseMaterialUsed(raw?: string): MaterialUsedFilter {
  if (raw === "used" || raw === "free") return raw;
  return "";
}

export function materialIsUsed(item: { usedByStyleCodes: string[]; usedByProjectCodes: string[] }) {
  return item.usedByStyleCodes.length + item.usedByProjectCodes.length > 0;
}

export function materialShelfExtras(input: { kind?: string; layout?: string; used?: string }) {
  const extras: Record<string, string> = { tab: "materials" };
  const kind = parseMaterialKind(input.kind);
  const layout = parseMaterialLayout(input.layout);
  const used = parseMaterialUsed(input.used);
  if (kind) extras.kind = kind;
  if (layout === "list") extras.layout = "list";
  if (used) extras.used = used;
  return extras;
}

export function materialShelfHref(input: { kind?: string; layout?: string; used?: string }, q = "") {
  return buildCatalogHref("/styles", materialShelfExtras(input), q);
}

export function filterMaterialShelf<T extends { kind: string; usedByStyleCodes: string[]; usedByProjectCodes: string[] }>(
  items: T[],
  input: { kind?: string; used?: string },
) {
  const kind = parseMaterialKind(input.kind);
  const used = parseMaterialUsed(input.used);
  return items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    if (used === "used" && !materialIsUsed(item)) return false;
    if (used === "free" && materialIsUsed(item)) return false;
    return true;
  });
}

export function sortMaterialShelfForFind<T extends { code: string }>(items: T[]) {
  return [...items].sort((a, b) => a.code.localeCompare(b.code));
}
