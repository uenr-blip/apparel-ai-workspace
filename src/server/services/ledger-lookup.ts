import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney,TradeError } from "@/lib/trade-money";
import { requireLedger,ledgerBook } from "./ledger-db";
import { requireTrade,cashCte } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import type { TradeOption } from "./trade-lookup";
export async function ledgerLookup(actor:TradeActor,input:{kind:string;bookId?:string;q?:string}):Promise<TradeOption[]>{
 const org=actor.organizationId,q=(input.q??"").trim().slice(0,100);
 if(input.kind==="accounts"){
  await requireLedger(actor);await ledgerBook(prisma,org,input.bookId??"");
  const rows=await prisma.$queryRaw<Array<{id:string;code:string;name:string}>>(Prisma.sql`SELECT id,code,name FROM GLAccount WHERE bookId=${input.bookId??""} AND active=1 ${q?Prisma.sql`AND instr(lower(code||' '||name),lower(${q}))>0`:Prisma.empty} ORDER BY code LIMIT 20`);return rows.map(a=>({id:a.id,label:`${a.code} · ${a.name}`}));
 }
 await requireTrade(actor);
 if(input.kind==="refund_sources"||input.kind==="fx_sources"){
  const rows=await prisma.$queryRaw<Array<{id:string;bankReference:string;partyName:string;currency:string;amount:bigint;version:bigint}>>(Prisma.sql`${cashCte(org)}, eligible AS(SELECT id,bankReference,partyName,currency,version,
    ${input.kind==="refund_sources"?Prisma.sql`MIN(availableMinor,amountMinor-refundedMinor-COALESCE((SELECT SUM(f.fromMinor) FROM TreasuryFx f WHERE f.organizationId=${org} AND f.sourceCashId=cash.id AND f.status='active'),0))`:Prisma.sql`amountMinor-feeMinor-refundedMinor-COALESCE((SELECT SUM(f.fromMinor) FROM TreasuryFx f WHERE f.organizationId=${org} AND f.sourceCashId=cash.id AND f.status='active'),0)`} amount FROM cash WHERE status='recorded' ${input.kind==="refund_sources"?Prisma.sql`AND cashKind IS NULL`:Prisma.sql`AND direction='receive'`}) SELECT * FROM eligible WHERE amount>0 ${q?Prisma.sql`AND instr(lower(bankReference||' '||partyName),lower(${q}))>0`:Prisma.empty} LIMIT 20`);
  return rows.map(r=>({id:r.id,label:`${r.bankReference} · ${r.partyName} · 可关联 ${r.currency} ${formatMoney(r.amount,r.currency)}`,currency:r.currency,amount:formatMoney(r.amount,r.currency),version:Number(r.version)}));
 }
 await requireLedger(actor);let rows:Array<{id:string;label:string;currency:string;amount:bigint}>=[];
 if(input.kind==="source_bill")rows=await prisma.$queryRaw(Prisma.sql`SELECT b.id,COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label'))||' · '||b.title label,b.currency,b.amountMinor amount FROM TradeBill b LEFT JOIN SalesOrder o ON o.id=b.orderId AND o.organizationId=b.organizationId WHERE b.organizationId=${org} AND b.status='confirmed' ${q?Prisma.sql`AND instr(COALESCE(o.orderNo,json_extract(b.subjectJson,'$.label'))||' '||b.title,${q})>0`:Prisma.empty} ORDER BY b.createdAt DESC LIMIT 20`);
 else if(input.kind==="source_cash")rows=await prisma.$queryRaw(Prisma.sql`${cashCte(org)} SELECT id,bankReference||' · '||partyName label,currency,amountMinor amount FROM cash WHERE status='recorded' AND cashKind IS NULL ${q?Prisma.sql`AND instr(bankReference||' '||partyName,${q})>0`:Prisma.empty} LIMIT 20`);
 else if(input.kind==="source_adjustment")rows=await prisma.$queryRaw(Prisma.sql`SELECT a.id,b.title||' · '||a.reason label,b.currency,a.amountMinor amount FROM TradeAdjustment a JOIN TradeBill b ON b.id=a.billId AND b.organizationId=a.organizationId WHERE a.organizationId=${org} AND b.status='confirmed' ${q?Prisma.sql`AND instr(b.title||' '||a.reason,${q})>0`:Prisma.empty} ORDER BY a.createdAt DESC LIMIT 20`);
 else if(input.kind==="source_refund")rows=await prisma.$queryRaw(Prisma.sql`SELECT r.id,c.bankReference label,c.currency,r.amountMinor amount FROM TreasuryRefund r JOIN TradeCash c ON c.id=r.counterCashId AND c.organizationId=r.organizationId WHERE r.organizationId=${org} AND r.status='active' ${q?Prisma.sql`AND instr(c.bankReference,${q})>0`:Prisma.empty} ORDER BY r.createdAt DESC LIMIT 20`);
 else if(input.kind==="source_fx")rows=await prisma.$queryRaw(Prisma.sql`SELECT id,bankReference label,toCurrency currency,toMinor amount FROM TreasuryFx WHERE organizationId=${org} AND status='active' ${q?Prisma.sql`AND instr(bankReference,${q})>0`:Prisma.empty} ORDER BY createdAt DESC LIMIT 20`);
 else throw new TradeError("不支持的账务查找类型");
 return rows.map(r=>({id:r.id,label:`${r.label} · ${r.currency} ${formatMoney(r.amount,r.currency)}`,currency:r.currency,amount:formatMoney(r.amount,r.currency)}));
}
