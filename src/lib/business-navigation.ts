export const BUSINESS_NAV = [
  { id: "workspace", href: "/workspace", label: "工作台", note: "待办 · 交接与确认", group: "start" },
  { id: "intake", href: "/inbox", label: "客户来单", note: "收 PO · 整理与核对", group: "start" },
  { id: "development", href: "/styles?tab=projects", label: "开发打版", note: "版单 · 改版 · 工厂打样", group: "business" },
  { id: "sales", href: "/orders?sheet=sales", label: "销售样", note: "样单 · 客户确认 · 转大货", group: "business" },
  { id: "bulk", href: "/orders?sheet=bulk", label: "大货跟单", note: "工厂总表 · PO · 交期", group: "business" },
  { id: "production", href: "/delivery", label: "工厂生产", note: "生产单 · 进度 · 转厂", group: "business" },
  { id: "finance", href: "/finance", label: "财务对账", note: "收付 · 对账 · 结汇", group: "business" },
  { id: "resources", href: "/resources?view=library", label: "资料与库存", note: "面辅料 · 往来单位 · 收发料", group: "shared" },
] as const;

export type BusinessSection = (typeof BUSINESS_NAV)[number]["id"];
export const businessHref = (section: BusinessSection) => BUSINESS_NAV.find(item => item.id === section)!.href;

export function visibleBusinessNav(role: string, canOpenFinance: boolean) {
  return BUSINESS_NAV.filter(item => (item.id !== "finance" || canOpenFinance) &&
    (item.id !== "intake" || role === "manager" || role === "salesperson"));
}

/** URL queries distinguish the two follow-up tables; detail pages supply their saved stage. */
export function businessSectionForRoute(pathname: string, params: Pick<URLSearchParams, "get">, followSection?: "sales" | "bulk"): BusinessSection | null {
  if (pathname === "/orders") {
    if (params.get("view") === "orders") return "production";
    if (params.get("view") === "season") return "bulk";
    if (params.get("sheet") === "bulk") return "bulk";
    if (params.get("sheet") === "sales") return "sales";
    return followSection ?? null;
  }
  if (pathname === "/orders/follow/print") return params.get("sheet") === "sales" ? "sales" : "bulk";
  if (pathname.startsWith("/orders/follow/")) return followSection ?? null;
  if (pathname.startsWith("/orders/") || pathname === "/delivery" || pathname.startsWith("/delivery/")) return "production";
  if (pathname === "/styles" && params.get("tab") === "materials") return "resources";
  if (pathname === "/styles" || pathname.startsWith("/styles/") || pathname.startsWith("/projects/")) return "development";
  if (pathname === "/inbox" || pathname.startsWith("/inbox/")) return "intake";
  if (pathname === "/resources" || pathname.startsWith("/resources/")) return "resources";
  if (pathname === "/finance" || pathname.startsWith("/finance/")) return "finance";
  if (pathname === "/workspace" || pathname === "/decisions" || pathname.startsWith("/decisions/")) return "workspace";
  return null;
}
