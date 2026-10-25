import { exportTrade } from "@/server/services/trade-export";
import { tradeHttpError, tradeSession } from "@/server/services/trade-http";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams, filter = Object.fromEntries(["q", "state", "currency", "direction", "orderId", "partyId", "from", "to", "projectId", "followRowId", "stageOnly"].map(key => [key, (params.get(key) ?? "").slice(0, 120)]));
    const result = await exportTrade(await tradeSession(), params.get("kind") ?? "", filter);
    return new Response(result.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${result.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return tradeHttpError(error); }
}
