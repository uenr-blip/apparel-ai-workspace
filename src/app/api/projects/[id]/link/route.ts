import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { linkProjectToStyle } from "@/server/services/reuse";
import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";

const Schema = z.object({ styleId: z.string().min(1).max(100) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    checkTradeOrigin(request);
    const { id } = await context.params;
    const parsed = Schema.safeParse(JSON.parse((await boundedBody(request, 2048)).toString("utf8")));
    if (!parsed.success) return NextResponse.json({ error: "请选择款式" }, { status: 400 });
    const result = await linkProjectToStyle({
      organizationId: session.organizationId,
      userId: session.id,
      projectId: id,
      styleId: parsed.data.styleId,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !error.name.startsWith("Prisma") ? error.message : "关联失败" }, { status: error instanceof TradeError ? error.status : 400 });
  }
}
