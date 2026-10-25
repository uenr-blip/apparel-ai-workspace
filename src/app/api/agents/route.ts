import { NextResponse } from "next/server";
import { z } from "zod";
import { Module } from "@/server/agents/business-tools";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { agentStatus, agentOptions, AGENT_PROFILES } from "@/lib/agent-config";
import { tradeSession, boundedBody, checkTradeOrigin } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
const Input = z.object({ module: Module, text: z.string().min(2).max(1000), profile: z.enum(AGENT_PROFILES).optional() }).strict();
export async function GET() {
  try { await tradeSession(); return NextResponse.json({ ...agentStatus(), options: agentOptions() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "请先登录" }, { status: 401 }); }
}
export async function POST(request: Request) {
  try {
    const actor = await tradeSession(); checkTradeOrigin(request);
    const input = Input.parse(JSON.parse((await boundedBody(request, 6000)).toString("utf8")));
    const data = await runBusinessAgent(actor, input.module, input.text, undefined, input.profile);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const message = e instanceof z.ZodError || e instanceof SyntaxError ? "请检查输入内容" : e instanceof Error && e.name.startsWith("Prisma") ? "业务资料暂不可读，请稍后重试" : e instanceof Error ? e.message : "本次查询未完成";
    return NextResponse.json({ error: message }, { status: e instanceof TradeError ? e.status : /无权/.test(message) ? 403 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
