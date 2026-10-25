import { NextResponse } from "next/server";
import { runTradeCommand } from "@/server/services/trade-write";
import { tradeSession, checkTradeOrigin, boundedBody, tradeHttpError } from "@/server/services/trade-http";
import { requireTrade } from "@/server/services/trade-db";
import { TradeError } from "@/lib/trade-money";
export async function POST(request: Request) {
  try {
    checkTradeOrigin(request); const actor = await tradeSession(); await requireTrade(actor);
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("multipart/form-data")) {
      await requireTrade(actor, "trade_prepare");
      const bytes = await boundedBody(request, 8 * 1024 * 1024 + 65536);
      const form = await new Request(request.url, { method: "POST", headers: request.headers, body: new Uint8Array(bytes) }).formData();
      const commandText = form.get("command"); if (typeof commandText !== "string" || commandText.length > 65536) throw new TradeError("单证内容格式不正确");
      const file = form.get("file"), input = JSON.parse(commandText);
      if (!["add_document", "attach_document", "create_stage_expense"].includes(input?.action)) throw new TradeError("附件仅用于单证登记");
      const result = await runTradeCommand(actor, input, file instanceof File && file.size ? { filename: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) } : undefined);
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (!contentType.startsWith("application/json")) throw new TradeError("请使用JSON提交", 415);
    const body = await boundedBody(request, 65536);
    return NextResponse.json(await runTradeCommand(actor, JSON.parse(body.toString("utf8"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return tradeHttpError(error); }
}
