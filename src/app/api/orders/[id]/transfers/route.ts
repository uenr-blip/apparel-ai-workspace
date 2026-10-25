import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestFactoryTransfer } from "@/server/services/factory-transfer";
const Schema = z.object({ stage: z.enum(["unstarted", "cut", "sewn"]).optional(), processNote: z.string().max(4000).optional(), toFactoryId: z.string().min(1).max(100), reason: z.string().min(1).max(2000), sourceReference: z.string().min(1).max(2000), stamp: z.string().min(1).max(100), idempotencyKey: z.string().min(8).max(80), selections: z.array(z.object({ sizeId: z.string().min(1).max(100), quantity: z.number().int().positive().max(2147483647) }).strict()).min(1).max(1000) }).strict();
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try { checkTradeOrigin(request); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const user = await getSession(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = Schema.safeParse(await boundedBody(request, 120000).then(b => JSON.parse(b.toString("utf8"))).catch(() => null)); if (!body.success) return NextResponse.json({ error: "请核对工厂、颜色尺码数量、原因和依据" }, { status: 400 });
  try { return NextResponse.json(await requestFactoryTransfer({ organizationId: user.organizationId, userId: user.id, role: user.role, factoryId: user.factoryId }, { ...body.data, orderId: (await ctx.params).id })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "未保存转厂" }, { status: 400 }); }
}
