import { NextResponse } from "next/server";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
import { findPatternReferences, PatternError } from "@/server/services/pattern-workflow";
export async function GET(request: Request) {
  try { return NextResponse.json(await findPatternReferences(await tradeSession(), new URL(request.url).searchParams.get("q") || ""), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return e instanceof PatternError ? NextResponse.json({ error: e.message }, { status: 403 }) : tradeHttpError(e); }
}
