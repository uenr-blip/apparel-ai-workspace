import { NextResponse } from "next/server";
import { tradeSession,tradeHttpError } from "@/server/services/trade-http";
import { materialLookup } from "@/server/services/material-lookup";
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;return NextResponse.json({rows:await materialLookup(await tradeSession(),{kind:q.get("kind")??"",q:q.get("q")??"",orderId:q.get("orderId")??"",receiptId:q.get("receiptId")??"",materialId:q.get("materialId")??"",partyId:q.get("partyId")??""})},{headers:{"Cache-Control":"no-store"}});}catch(error){return tradeHttpError(error);}}
