import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { TradeActor } from "@/server/services/trade-contract";
import { FollowSuggestion } from "@/lib/follow-assistant";
import { PLATFORM_CONTEXT_VERSION } from "@/server/context/platform";
import type { resolveContext } from "@/server/context/context-service";
function secret() { const value = process.env.SESSION_SECRET; if (!value || value.length < 16) throw new Error("会话配置不完整，无法生成可确认建议"); return new TextEncoder().encode(value); }
const Ticket = z.object({ org: z.string(), user: z.string(), original: FollowSuggestion, text: z.string().max(1000), model: z.string(), version: z.string(), references: z.array(z.object({ scope: z.enum(["company", "follow"]), revisionId: z.string() })) });
export async function signFollowTicket(actor: TradeActor, original: FollowSuggestion, context: Awaited<ReturnType<typeof resolveContext>>["manifest"], text: string, model: string) {
  return new SignJWT({ org: actor.organizationId, user: actor.userId, original, text, model, version: context.platformVersion, references: context.references.map(r => ({scope:r.scope,revisionId:r.revisionId})) }).setProtectedHeader({alg:"HS256"}).setAudience("yiju-follow-preview").setIssuedAt().setExpirationTime("30m").sign(secret());
}
export async function verifyFollowTicket(db: Prisma.TransactionClient, actor: Pick<TradeActor,"organizationId"|"userId">, raw: string) {
  let data: z.infer<typeof Ticket>;
  try { data=Ticket.parse((await jwtVerify(raw,secret(),{audience:"yiju-follow-preview",algorithms:["HS256"]})).payload); }
  catch { throw new Error("跟单建议已过期或校验失败，请重新生成"); }
  if (data.org!==actor.organizationId || data.user!==actor.userId) throw new Error("只能确认当前账号生成的跟单建议");
  const rows=await db.organizationPolicy.findMany({where:{organizationId:actor.organizationId,key:{in:["context:active:company","context:active:follow"]}}});
  const refs=rows.map(r=>({scope:r.key.split(":").at(-1)!,revisionId:JSON.parse(r.valueJson).revisionId})).sort((a,b)=>a.scope.localeCompare(b.scope));
  if(data.version!==PLATFORM_CONTEXT_VERSION || JSON.stringify(refs)!==JSON.stringify([...data.references].sort((a,b)=>a.scope.localeCompare(b.scope)))) throw new Error("跟单规则已更新，请重新生成建议后确认");
  return { original:data.original, originalText:data.text, model:data.model, context:{version:data.version,references:data.references} };
}
