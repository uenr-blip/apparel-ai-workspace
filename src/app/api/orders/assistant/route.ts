import { agentConfig, AGENT_PROFILES } from "@/lib/agent-config";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { TradeError } from "@/lib/trade-money";
import { boundedBody, checkTradeOrigin } from "@/server/services/trade-http";
import { confirmOrderAssistant, previewOrderAssistant, searchOrderAssistant } from "@/server/services/order-assistant";

const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("search"), text: z.string().min(5).max(1000), profile: z.enum(AGENT_PROFILES).optional() }).strict(),
  z.object({ action: z.literal("preview"), text: z.string().min(5).max(1000), candidateId: z.string().min(1).max(120), idempotencyKey: z.string().min(8).max(120) }).strict(),
  z.object({ action: z.literal("confirm"), proposalId: z.string().min(1).max(120), confirmed: z.literal(true) }).strict(),
]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  try {
    checkTradeOrigin(request);
    const raw = await boundedBody(request, 8000);
    const command = Command.parse(JSON.parse(raw.toString("utf8")));
    const actor = { organizationId: session.organizationId, userId: session.id, role: session.role, factoryId: session.factoryId };
    const result = command.action === "search" ? await (async () => {
      if (agentConfig().mode === "mock") return searchOrderAssistant(actor, command.text);
      const run = await runBusinessAgent(actor, "order", command.text, undefined, command.profile);
      if (!run.orderResult) throw new Error(run.answer || "请写清客户完整名称和款类，重新查询");
      return { ...run.orderResult, modeLabel: run.status.label, steps: run.steps };
    })()
      : command.action === "preview" ? await previewOrderAssistant(actor, command) : await confirmOrderAssistant(actor, command);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof z.ZodError || error instanceof SyntaxError ? "请检查输入内容" : error instanceof Error ? error.message : "建单失败";
    return NextResponse.json({ error: message }, { status: error instanceof TradeError ? error.status : /无权/.test(message) ? 403 : 400 });
  }
}
