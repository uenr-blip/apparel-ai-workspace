export function buildCatalogHref(action: string, extras: Record<string, string> = {}, q = "") {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(extras)) {
    if (value) params.set(name, value);
  }
  const query = catalogQuery(q);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `${action}?${search}` : action;
}

export function catalogQuery(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").trim();
}

export function matchesCatalogQuery(query: string, parts: Array<string | number | null | undefined>) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return parts.some((part) => String(part ?? "").toLowerCase().includes(needle));
}
