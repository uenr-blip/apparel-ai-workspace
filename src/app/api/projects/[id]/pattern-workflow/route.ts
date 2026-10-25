import { NextResponse } from "next/server";
import { z } from "zod";
import { tradeSession, boundedBody, checkTradeOrigin, tradeHttpError } from "@/server/services/trade-http";
import { getPatternBoard, patternCommand, PatternError } from "@/server/services/pattern-workflow";
const headers = { "Cache-Control": "no-store" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await getPatternBoard(await tradeSession(), (await context.params).id), { headers }); }
  catch (e) { return e instanceof PatternError ? NextResponse.json({ error: e.message }, { status: 403, headers }) : tradeHttpError(e); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    return NextResponse.json(await patternCommand(actor, (await context.params).id, JSON.parse((await boundedBody(request, 30000)).toString("utf8"))), { headers });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0]?.message || "请检查填写内容，并明确勾选确认" }, { status: 400, headers });
    return e instanceof PatternError ? NextResponse.json({ error: e.message }, { status: 400, headers }) : tradeHttpError(e);
  }
}
