import { NextResponse } from "next/server";
import { tradeSession,tradeHttpError } from "@/server/services/trade-http";
import { searchBusiness } from "@/server/services/business-search";
export async function GET(request:Request) {
  try {const params=new URL(request.url).searchParams;return NextResponse.json(await searchBusiness(await tradeSession(),params.get("q"),{suggest:true}),{headers:{"Cache-Control":"no-store"}});}
  catch(e){return tradeHttpError(e);}
}
