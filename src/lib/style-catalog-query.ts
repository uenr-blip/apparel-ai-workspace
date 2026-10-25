import { buildCatalogHref } from "@/lib/catalog-query";

export type StyleLayout = "list" | "cards";
export type StyleOrderFilter = "" | "ordered" | "open";

export function parseStyleLayout(raw?: string): StyleLayout {
  return raw === "list" ? "list" : "cards";
}

export function parseStyleOrder(raw?: string): StyleOrderFilter {
  if (raw === "ordered" || raw === "open") return raw;
  return "";
}

export function styleHasOrder(style: { orderPos: unknown[] }) {
  return style.orderPos.length > 0;
}

export function styleCatalogExtras(input: { layout?: string; ordered?: string }) {
  const extras: Record<string, string> = {};
  if (parseStyleLayout(input.layout) === "list") extras.layout = "list";
  const ordered = parseStyleOrder(input.ordered);
  if (ordered) extras.ordered = ordered;
  return extras;
}

export function styleCatalogHref(input: { layout?: string; ordered?: string }, q = "") {
  return buildCatalogHref("/styles", styleCatalogExtras(input), q);
}

export function filterStyleCatalog<T extends { orderPos: unknown[] }>(items: T[], ordered?: string) {
  const filter = parseStyleOrder(ordered);
  return items.filter((item) => {
    if (filter === "ordered" && !styleHasOrder(item)) return false;
    if (filter === "open" && styleHasOrder(item)) return false;
    return true;
  });
}

export function sortStyleCatalogForFind<T extends { code: string }>(items: T[]) {
  return [...items].sort((a, b) => a.code.localeCompare(b.code));
}
