import { NextResponse } from "next/server";
import { expenseSubject } from "@/server/services/stage-expenses";
import { tradeSession, tradeHttpError } from "@/server/services/trade-http";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const subject = await expenseSubject(await tradeSession(), { projectId: params.get("projectId") || undefined, followRowId: params.get("followRowId") || undefined });
    return NextResponse.json(subject, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return tradeHttpError(error); }
}
