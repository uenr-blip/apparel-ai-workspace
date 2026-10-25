import { NextResponse } from "next/server";
import { z } from "zod";
import { tradeSession,boundedBody,checkTradeOrigin,tradeHttpError } from "@/server/services/trade-http";
import { PatternError,previewPatternReference } from "@/server/services/pattern-workflow";
const Input=z.object({idempotencyKey:z.string().min(8).max(100),request:z.unknown()}).strict();
export async function POST(request:Request){try{const actor=await tradeSession();checkTradeOrigin(request);const body=Input.parse(JSON.parse((await boundedBody(request,20000)).toString("utf8")));return NextResponse.json(await previewPatternReference(actor,body.request,body.idempotencyKey),{headers:{"Cache-Control":"no-store"}});}catch(e){if(e instanceof PatternError || e instanceof z.ZodError)return NextResponse.json({error:e instanceof PatternError?e.message:e.issues[0]?.message||"请核对输入"},{status:400});return tradeHttpError(e);}}
