import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId,sha256 } from "@/lib/hash";
import { checkDate,TradeError } from "@/lib/trade-money";
import { writeAudit } from "./intake";
import { requireTrade,type TradeDb } from "./trade-db";
import { NEXT_FINANCE_PERMISSIONS,type NextFinancePermission } from "./ledger-contract";
import type { TradeActor } from "./trade-contract";
export async function ledgerPermissions(actor:TradeActor,db:TradeDb=prisma){
 const user=await db.user.findFirst({where:{id:actor.userId,organizationId:actor.organizationId,role:actor.role,active:true}});
 if(!user||!["manager","salesperson"].includes(user.role))return new Set<string>();
 if(user.role==="manager")return new Set(NEXT_FINANCE_PERMISSIONS.map(p=>p.action));
 const policies=await db.organizationPolicy.findMany({where:{organizationId:actor.organizationId,enabled:true,key:{in:NEXT_FINANCE_PERMISSIONS.map(p=>`user-action:${encodeURIComponent(user.id)}:${p.action}`)}},select:{key:true}});
 return new Set(policies.map(p=>p.key.split(":").at(-1)!));
}
export async function requireLedger(actor:TradeActor,permission:NextFinancePermission="ledger_view",db:TradeDb=prisma){
 const grants=await ledgerPermissions(actor,db);
 if(permission.startsWith("treasury_"))await requireTrade(actor,"trade_view",db);
 else if(!grants.has("ledger_view"))throw new TradeError("无权查阅总账，请经理下发权限",403);
 if(!grants.has(permission))throw new TradeError("无权执行此账务动作，请经理下发相应权限",403);
}
export type BookRow={id:string;organizationId:string;name:string;baseCurrency:string;startMonth:string;mode:string};
export type JournalRow={id:string;bookId:string;date:string;summary:string;basis:string;status:string;version:bigint|number;number:string|null;sourceType:string;sourceId:string|null;sourceHash:string|null;sourceJson:string|null;expectedTotalMinor:bigint|null;reversesId:string|null;reversedById:string|null;createdBy:string;reviewedBy:string|null;postedBy:string|null;createdAt:string;voidReason:string|null};
export type LineRow={id:string;journalId:string;accountId:string;lineNo:bigint|number;accountCode:string;accountName:string;debitMinor:bigint;creditMinor:bigint;note:string};
export async function ledgerBook(db:TradeDb,org:string,id:string){const [b]=await db.$queryRaw<BookRow[]>`SELECT * FROM GLBook WHERE organizationId=${org} AND id=${id}`;if(!b)throw new TradeError("账套不存在或不属于当前组织",404);return b;}
export async function journalRow(db:TradeDb,org:string,id:string){const [j]=await db.$queryRaw<JournalRow[]>`SELECT j.* FROM GLJournal j JOIN GLBook b ON b.id=j.bookId WHERE b.organizationId=${org} AND j.id=${id}`;if(!j)throw new TradeError("凭证不存在或不属于当前组织",404);return j;}
export async function journalLines(db:TradeDb,id:string){return db.$queryRaw<LineRow[]>`SELECT * FROM GLLine WHERE journalId=${id} ORDER BY lineNo`;}
export function monthCheck(month:string){checkDate(`${month}-01`);return month;}
export async function openPeriod(db:TradeDb,book:BookRow,date:string){checkDate(date);const [p]=await db.$queryRaw<Array<{id:string;status:string;nextNumber:bigint}>>`SELECT id,status,nextNumber FROM GLPeriod WHERE bookId=${book.id} AND month=${date.slice(0,7)}`;if(!p||p.status!=="open")throw new TradeError("凭证日期所属期间未建立或已经关闭");return p;}
export async function requireUnpostedSource(db:TradeDb,org:string,kind:string,id:string){
 const [row]=await db.$queryRaw<Array<{id:string}>>`SELECT c.id FROM GLSourceClaim c JOIN GLBook b ON b.id=c.bookId JOIN GLJournal j ON j.id=c.journalId WHERE b.organizationId=${org} AND c.activeKey IS NOT NULL AND j.status='posted' AND (c.sourceType=${kind} AND c.sourceId=${id} OR (${kind}='bill' AND c.sourceType='adjustment' AND c.sourceId IN(SELECT a.id FROM TradeAdjustment a WHERE a.organizationId=${org} AND a.billId=${id}))) LIMIT 1`;
 if(row)throw new TradeError("来源已有过账凭证，请先完成相应反向凭证，再更正业务登记",409);
}
export function sourceHash(value:unknown){return sha256(JSON.stringify(value,(_,v)=>typeof v==="bigint"?v.toString():v));}
export async function financialWrite(actor:TradeActor,namespace:string,command:{action:string;idempotencyKey:string},permission:NextFinancePermission,execute:(db:TradeDb,now:string)=>Promise<{id:string;summary:string}>){
 await requireLedger(actor,permission);
 return prisma.$transaction(async db=>{
  await db.$executeRaw`INSERT INTO TradeBook(organizationId,revision) VALUES(${actor.organizationId},1) ON CONFLICT(organizationId) DO UPDATE SET revision=revision+1`;
  await requireLedger(actor,permission,db);const key=`${namespace}:${command.idempotencyKey}`,hash=sourceHash(command);
  const [prior]=await db.$queryRaw<Array<{requestHash:string;resultJson:string}>>`SELECT requestHash,resultJson FROM TradeOperation WHERE organizationId=${actor.organizationId} AND idempotencyKey=${key}`;
  if(prior){if(prior.requestHash!==hash)throw new TradeError("同一凭证标识的内容不同",409);return {...JSON.parse(prior.resultJson) as {id:string;summary:string},reused:true};}
  const now=new Date().toISOString(),result=await execute(db,now);
  await writeAudit({organizationId:actor.organizationId,actorUserId:actor.userId,action:`${namespace}.${command.action}`,entityType:namespace==="ledger"?"GeneralLedger":"Treasury",entityId:result.id,summary:result.summary,payloadJson:JSON.stringify(command)},db);
  await db.$executeRaw`INSERT INTO TradeOperation(id,organizationId,idempotencyKey,requestHash,resultJson,createdAt) VALUES(${createId()},${actor.organizationId},${key},${hash},${JSON.stringify(result)},${now})`;
  return {...result,reused:false};
 },{timeout:20000,maxWait:5000});
}
export const ledgerScope=(org:string)=>Prisma.sql`SELECT b.id FROM GLBook b WHERE b.organizationId=${org}`;
