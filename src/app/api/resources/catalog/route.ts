import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { CatalogCommand, maintainCatalog } from "@/server/services/catalog-maintenance";
export async function POST(request: Request) {
  try { checkTradeOrigin(request); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const u = await getSession(); if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = CatalogCommand.safeParse(await boundedBody(request, 120000).then(b => JSON.parse(b.toString("utf8"))).catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "请填写资料名称和本次操作原因" }, { status: 400 });
  try { return NextResponse.json(await maintainCatalog({ organizationId: u.organizationId, userId: u.id, role: u.role }, parsed.data)); }
  catch (e) { const duplicate = e && typeof e === "object" && "code" in e && e.code === "P2002"; return NextResponse.json({ error: duplicate ? "该编号已存在，请选择原记录或使用新的编号" : e instanceof Error ? e.message : "未保存资料" }, { status: 400 }); }
}
