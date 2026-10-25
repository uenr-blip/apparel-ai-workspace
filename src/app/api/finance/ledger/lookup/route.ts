import { NextResponse } from "next/server";
import { tradeSession,tradeHttpError } from "@/server/services/trade-http";
import { ledgerLookup } from "@/server/services/ledger-lookup";
export async function GET(request:Request){try{const q=new URL(request.url).searchParams;return NextResponse.json({rows:await ledgerLookup(await tradeSession(),{kind:q.get("kind")??"",q:q.get("q")??"",bookId:q.get("bookId")??""})},{headers:{"Cache-Control":"no-store"}});}catch(error){return tradeHttpError(error);}}
