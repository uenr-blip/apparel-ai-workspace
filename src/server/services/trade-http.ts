import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { TradeError } from "@/lib/trade-money";

export async function tradeSession() {
  const session = await getSession();
  if (!session) throw new TradeError("请先登录", 401);
  return { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
}
export function checkTradeOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url), host = request.headers.get("host") ?? url.host;
  let matches = !origin;
  if (origin) {
    try { const caller = new URL(origin); matches = caller.host === host && caller.protocol === url.protocol; }
    catch { matches = false; }
  }
  if (!matches || request.headers.get("sec-fetch-site") === "cross-site") throw new TradeError("请求来源不匹配", 403);
}
export async function boundedBody(request: Request, limit: number) {
  const stated = Number(request.headers.get("content-length") ?? 0);
  if (stated > limit) throw new TradeError("提交内容超过大小限制", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new TradeError("请求内容为空");
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new TradeError("提交内容超过大小限制", 413); }
      parts.push(result.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
export function tradeHttpError(error: unknown) {
  if (error instanceof TradeError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "提交内容格式不正确" }, { status: 400 });
  return NextResponse.json({ error: "当前操作未能完成，请刷新核对后重试；重复请求不会重复记账" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
