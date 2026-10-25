import { NextResponse } from "next/server";
import { boundedBody,checkTradeOrigin,tradeSession,tradeHttpError } from "@/server/services/trade-http";
import { runMaterialCommand } from "@/server/services/material-write";
import { TradeError } from "@/lib/trade-money";
export async function POST(request:Request){try{checkTradeOrigin(request);const actor=await tradeSession();if(!request.headers.get("content-type")?.startsWith("application/json"))throw new TradeError("请使用JSON提交",415);return NextResponse.json(await runMaterialCommand(actor,JSON.parse((await boundedBody(request,65536)).toString())),{headers:{"Cache-Control":"no-store"}});}catch(error){return tradeHttpError(error);}}
