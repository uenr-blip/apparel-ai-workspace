import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { confirmTransferContinuation, acknowledgeFactoryTransfer, reviewFactoryTransfer } from "@/server/services/factory-transfer";
const Schema = z.object({ action: z.enum(["review", "approve", "reject", "receive", "check_continuation"]), note: z.string().min(1).max(4000), receivedQuantity: z.number().int().positive().optional(), continuationNote: z.string().max(3000).optional(), continuationReady: z.boolean().optional(), expectedUpdatedAt: z.string().optional() }).strict();
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try { checkTradeOrigin(request); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const user = await getSession(); if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = Schema.safeParse(await boundedBody(request, 120000).then(b => JSON.parse(b.toString("utf8"))).catch(() => null)); if (!body.success) return NextResponse.json({ error: "请填写核对结果" }, { status: 400 });
  try { if (body.data.action === "check_continuation") return NextResponse.json(await confirmTransferContinuation({ organizationId: user.organizationId, userId: user.id, role: user.role, factoryId: user.factoryId }, { id: (await ctx.params).id, note: body.data.note, continuationReady: body.data.continuationReady === true, expectedUpdatedAt: body.data.expectedUpdatedAt ?? "" })); if (body.data.action === "receive") return NextResponse.json(await acknowledgeFactoryTransfer({ organizationId: user.organizationId, userId: user.id, role: user.role, factoryId: user.factoryId }, { id: (await ctx.params).id, note: body.data.note, receivedQuantity: body.data.receivedQuantity, continuationNote: body.data.continuationNote, continuationReady: body.data.continuationReady })); return NextResponse.json(await reviewFactoryTransfer({ organizationId: user.organizationId, userId: user.id, role: user.role, factoryId: user.factoryId }, { action: body.data.action, note: body.data.note, id: (await ctx.params).id })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "未处理转厂" }, { status: 400 }); }
}
