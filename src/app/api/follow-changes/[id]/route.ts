import { checkTradeOrigin, boundedBody } from "@/server/services/trade-http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { decideFollowChange } from "@/server/services/follow-change";
const Schema=z.object({action:z.enum(["review","approve","reject"]),note:z.string().min(1).max(4000)}).strict();
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try { checkTradeOrigin(req); } catch { return NextResponse.json({ error: "请求来源不匹配" }, { status: 403 }); }
  const u=await getSession();if(!u)return NextResponse.json({error:"未登录"},{status:401});const p=Schema.safeParse(await boundedBody(req,120000).then(b=>JSON.parse(b.toString("utf8"))).catch(()=>null));if(!p.success)return NextResponse.json({error:"请填写处理意见"},{status:400});try{return NextResponse.json(await decideFollowChange({organizationId:u.organizationId,userId:u.id,role:u.role},{...p.data,id:(await ctx.params).id}));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"未处理"},{status:400});}}
