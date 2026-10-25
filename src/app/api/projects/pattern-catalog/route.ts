import { NextResponse } from "next/server";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
import { PatternError } from "@/server/services/pattern-workflow";
import { getPatternCatalogSource, searchPatternCatalog } from "@/server/services/pattern-catalog";

export async function GET(request: Request) {
  try {
    const actor = await tradeSession(), params = new URL(request.url).searchParams;
    const source = params.get("source");
    const result = source ? await getPatternCatalogSource(actor, source, params.get("material") || "") : await searchPatternCatalog(actor, params.get("q") || "");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return error instanceof PatternError ? NextResponse.json({ error: error.message }, { status: 400 }) : tradeHttpError(error);
  }
}
