import { NextResponse } from "next/server";
import { z } from "zod";
import { tradeSession, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
import { draftContext, listContext, publishContext } from "@/server/context/context-service";
const Command = z.discriminatedUnion("action", [z.object({ action: z.literal("draft"), draft: z.unknown() }).strict(), z.object({ action: z.literal("publish"), proposalId: z.string().min(1).max(120), confirmed: z.literal(true) }).strict()]);
function error(e: unknown) { return NextResponse.json({ error: e instanceof z.ZodError || e instanceof SyntaxError ? "请检查输入内容" : e instanceof Error && !e.name.startsWith("Prisma") ? e.message : "上下文操作未完成" }, { status: e instanceof TradeError ? e.status : e instanceof Error && /无权/.test(e.message) ? 403 : 400, headers: { "Cache-Control": "no-store" } }); }
export async function GET() { try { return NextResponse.json(await listContext(await tradeSession()), { headers: { "Cache-Control": "no-store" } }); } catch(e) { return error(e); } }
export async function POST(request: Request) { try { const actor = await tradeSession(); checkTradeOrigin(request); const command = Command.parse(JSON.parse((await boundedBody(request, 24000)).toString("utf8"))); return NextResponse.json(command.action === "draft" ? await draftContext(actor, command.draft) : await publishContext(actor, command.proposalId, command.confirmed), { headers: { "Cache-Control": "no-store" } }); } catch(e) { return error(e); } }
