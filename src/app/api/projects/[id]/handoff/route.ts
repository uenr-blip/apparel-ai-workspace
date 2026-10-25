import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { handoffPatternSample } from "@/server/services/pattern-handoff";
const Schema = z.object({ sampleId: z.string().min(1).max(100), projectStamp: z.string().datetime(), sampleStamp: z.string().datetime(), contextStamp: z.string().max(100), processNotes: z.string().max(8000), confirmed: z.literal(true) }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { checkTradeOrigin(request); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const u = await getSession(); if (!u) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const parsed = Schema.safeParse(await boundedBody(request, 120000).then(b => JSON.parse(b.toString("utf8"))).catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "请核对回样和交接说明" }, { status: 400 });
  try { return NextResponse.json(await handoffPatternSample({ organizationId: u.organizationId, userId: u.id, role: u.role, factoryId: u.factoryId }, { ...parsed.data, projectId: (await context.params).id })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "交接未保存" }, { status: 400 }); }
}
