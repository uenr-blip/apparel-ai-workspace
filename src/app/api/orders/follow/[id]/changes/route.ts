import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestFollowChange, verifyFollowChangeLinks } from "@/server/services/follow-change";
const Schema = z.object({ rowId:z.string(),stamp:z.string(),reason:z.string().min(1).max(2000),sourceReference:z.string().min(1).max(3000),values:z.object({po:z.string().max(160),shipDate:z.string().max(10),colors:z.array(z.object({colorName:z.string().min(1).max(100),quantity:z.number().int().nonnegative(),sizes:z.array(z.object({sizeCode:z.string().min(1).max(30),quantity:z.number().int().nonnegative()})).max(40)})).min(1).max(60)}) }).strict();
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try { checkTradeOrigin(req); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const u=await getSession();if(!u)return NextResponse.json({error:"未登录"},{status:401});try{const body=JSON.parse((await boundedBody(req,120000)).toString("utf8"));const actor={organizationId:u.organizationId,userId:u.id,role:u.role};const sheetId=(await ctx.params).id;if(body.action==="verify_links")return NextResponse.json(await verifyFollowChangeLinks(actor,sheetId));const p=Schema.safeParse(body);if(!p.success)return NextResponse.json({error:"请核对改单内容"},{status:400});return NextResponse.json(await requestFollowChange(actor,{...p.data,sheetId}));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"未保存"},{status:400});}}
