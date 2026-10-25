import { NextResponse } from "next/server";
import { boundedBody, checkTradeOrigin, tradeHttpError, tradeSession } from "@/server/services/trade-http";
import { reconciliationAccounts, saveReconciliationRule } from "@/server/services/reconciliation-rules";
import { TradeError } from "@/lib/trade-money";
export async function GET(request: Request) {
  try { const q = new URL(request.url).searchParams; return NextResponse.json({ rows: await reconciliationAccounts(await tradeSession(), q.get("bookId") ?? "", q.get("kind") ?? "", q.get("q") ?? "") }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return tradeHttpError(error); }
}
export async function POST(request: Request) {
  try {
    checkTradeOrigin(request); const actor = await tradeSession();
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new TradeError("请使用JSON提交", 415);
    const body = JSON.parse((await boundedBody(request, 65536)).toString());
    return NextResponse.json(await saveReconciliationRule(actor, body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return tradeHttpError(error); }
}
