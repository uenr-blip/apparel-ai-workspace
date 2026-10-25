import { NextResponse } from "next/server";
import { boundedBody,checkTradeOrigin,tradeSession,tradeHttpError } from "@/server/services/trade-http";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { TradeError } from "@/lib/trade-money";
export async function POST(request:Request){try{checkTradeOrigin(request);const actor=await tradeSession();if(!request.headers.get("content-type")?.startsWith("application/json"))throw new TradeError("请使用JSON提交",415);const body=JSON.parse((await boundedBody(request,65536)).toString());return NextResponse.json(await runLedgerCommand(actor,body),{headers:{"Cache-Control":"no-store"}});}catch(error){return tradeHttpError(error);}}
