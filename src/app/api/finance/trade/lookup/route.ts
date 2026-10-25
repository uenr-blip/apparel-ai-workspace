import { NextResponse } from "next/server";
import { tradeLookup } from "@/server/services/trade-lookup";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const rows = await tradeLookup(await tradeSession(), { kind: params.get("kind") ?? "", q: params.get("q") ?? "", orderId: params.get("orderId") ?? "", partyId: params.get("partyId") ?? "", direction: params.get("direction") ?? "" });
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return tradeHttpError(error); }
}
