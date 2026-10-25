import { NextResponse } from "next/server";
import { tradeSession, checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { authorizeAgent } from "@/server/agents/business-tools";
import { transcribeWav } from "@/server/ai/transcribe";
import { TradeError } from "@/lib/trade-money";
export async function POST(request:Request) {try {const actor=await tradeSession();checkTradeOrigin(request);await authorizeAgent(actor,"order");if(request.headers.get("content-type")!=="audio/wav")throw new Error("录音格式不正确");const result=await transcribeWav(await boundedBody(request,992044));return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});}catch(e){return NextResponse.json({error:e instanceof Error&&!e.name.startsWith("Prisma")?e.message:"语音转写未完成"},{status:e instanceof TradeError?e.status:400,headers:{"Cache-Control":"no-store"}});}}
