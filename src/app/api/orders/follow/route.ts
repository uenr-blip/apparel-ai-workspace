import { NextResponse } from "next/server";
import { z } from "zod";
import { createFollowSheet } from "@/server/services/order-merch";
import { FollowSuggestion } from "@/lib/follow-assistant";
import { tradeSession, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { TradeError } from "@/lib/trade-money";
const Schema=FollowSuggestion.extend({sourceStyleId:z.string().min(1).max(100).optional(),sourcePo:z.string().max(80).optional(),factoryId:z.string().max(100).optional(),customerId:z.string().max(100).optional(),seasonCode:z.string().max(40).optional(),factoryName:z.string().max(80).optional(),idempotencyKey:z.string().min(1).max(120),assistantTicket:z.string().max(12000).optional(),confirmed:z.boolean().optional()}).strict();
export async function POST(request:Request) {
  try { const actor=await tradeSession();checkTradeOrigin(request);const input=Schema.parse(JSON.parse((await boundedBody(request,20000)).toString("utf8")));return NextResponse.json(await createFollowSheet({...actor,...input}),{headers:{"Cache-Control":"no-store"}}); }
  catch(e){return NextResponse.json({error:e instanceof z.ZodError || e instanceof SyntaxError ? "请检查跟单表头" : e instanceof Error && !e.name.startsWith("Prisma") ? e.message : "跟单未建成，请刷新核对"},{status:e instanceof TradeError?e.status:e instanceof Error&&/不能|只能/.test(e.message)?403:400});}
}
