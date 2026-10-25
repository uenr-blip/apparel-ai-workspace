import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { formatMoney,TradeError } from "@/lib/trade-money";
import { requireTrade,cashCte,type CashRow } from "./trade-db";
import { ledgerBook,journalRow,journalLines,requireLedger,monthCheck,type JournalRow } from "./ledger-db";
import { resourcePage } from "./resource-scope";
import { cashView } from "./trade-read";
import type { TradeActor } from "./trade-contract";

export async function listLedgerBooks(actor:TradeActor){await requireLedger(actor);return prisma.$queryRaw<Array<{id:string;name:string;baseCurrency:string;startMonth:string;mode:string}>>`SELECT id,name,baseCurrency,startMonth,mode FROM GLBook WHERE organizationId=${actor.organizationId} ORDER BY createdAt DESC LIMIT 100`;}
export async function getLedgerBook(actor:TradeActor,id:string){await requireLedger(actor);const book=await ledgerBook(prisma,actor.organizationId,id);const [accounts,periods]=await prisma.$transaction([
 prisma.$queryRaw<Array<{id:string;code:string;name:string;category:string;active:boolean|bigint}>>`SELECT id,code,name,category,active FROM GLAccount WHERE bookId=${id} ORDER BY code LIMIT 500`,
 prisma.$queryRaw<Array<{id:string;month:string;status:string;closeNote:string|null}>>`SELECT id,month,status,closeNote FROM GLPeriod WHERE bookId=${id} ORDER BY month DESC LIMIT 120`,
 ]);return {...book,accounts:accounts.map(a=>({...a,active:!!a.active})),periods};}
export async function listLedgerJournals(actor:TradeActor,bookId:string,filter:{q?:string;month?:string;status?:string;page?:string|number}={}){
 await requireLedger(actor);const book=await ledgerBook(prisma,actor.organizationId,bookId),page=resourcePage(filter.page),q=(filter.q??"").trim().slice(0,100);
 const where=Prisma.sql`bookId=${bookId} ${filter.month?Prisma.sql`AND substr(date,1,7)=${monthCheck(filter.month)}`:Prisma.empty} ${["draft","reviewed","posted","void"].includes(filter.status??"")?Prisma.sql`AND status=${filter.status}`:Prisma.empty} ${q?Prisma.sql`AND instr(lower(COALESCE(number,'')||' '||summary),lower(${q}))>0`:Prisma.empty}`;
 const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>(Prisma.sql`SELECT COUNT(*) n FROM GLJournal WHERE ${where}`),prisma.$queryRaw<JournalRow[]>(Prisma.sql`SELECT * FROM GLJournal WHERE ${where} ORDER BY date DESC,createdAt DESC,id LIMIT 20 OFFSET ${(page-1)*20}`)]);
 return {book,page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(j=>({id:j.id,date:j.date,summary:j.summary,status:j.status,number:j.number,sourceType:j.sourceType,reversedById:j.reversedById,version:Number(j.version)}))};
}
export async function getLedgerJournal(actor:TradeActor,id:string){
 await requireLedger(actor);const j=await journalRow(prisma,actor.organizationId,id),book=await ledgerBook(prisma,actor.organizationId,j.bookId),lines=await journalLines(prisma,id);
 const debit=lines.reduce((sum,l)=>sum+l.debitMinor,BigInt(0)),credit=lines.reduce((sum,l)=>sum+l.creditMinor,BigInt(0));
 const users=await prisma.user.findMany({where:{organizationId:actor.organizationId,id:{in:[j.createdBy,j.reviewedBy??"",j.postedBy??""]}},select:{id:true,name:true}});const name=(id:string|null)=>users.find(u=>u.id===id)?.name??"—";
 const events=await prisma.auditEvent.findMany({where:{organizationId:actor.organizationId,entityType:"GeneralLedger",entityId:id},select:{id:true,summary:true,createdAt:true,actor:{select:{name:true}}},orderBy:{createdAt:"desc"},take:20});
 return {...j,version:Number(j.version),expectedTotalMinor:undefined,expectedTotal:j.expectedTotalMinor===null?null:formatMoney(j.expectedTotalMinor,book.baseCurrency),book,debit:formatMoney(debit,book.baseCurrency),credit:formatMoney(credit,book.baseCurrency),balanced:debit===credit&&debit>BigInt(0),creatorName:name(j.createdBy),reviewerName:name(j.reviewedBy),posterName:name(j.postedBy),lines:lines.map(l=>({id:l.id,accountId:l.accountId,code:l.accountCode,name:l.accountName,debit:formatMoney(l.debitMinor,book.baseCurrency),credit:formatMoney(l.creditMinor,book.baseCurrency),note:l.note})),events};
}
export async function getLedgerTrial(actor:TradeActor,bookId:string,month:string){
 await requireLedger(actor);const book=await ledgerBook(prisma,actor.organizationId,bookId);monthCheck(month);
 const rows=await prisma.$queryRaw<Array<{id:string;code:string;name:string;category:string;opening:bigint;debit:bigint;credit:bigint}>>`SELECT a.id,a.code,a.name,a.category,
 COALESCE(SUM(CASE WHEN j.status='posted' AND substr(j.date,1,7)<${month} THEN l.debitMinor-l.creditMinor ELSE 0 END),0) opening,
 COALESCE(SUM(CASE WHEN j.status='posted' AND substr(j.date,1,7)=${month} THEN l.debitMinor ELSE 0 END),0) debit,
 COALESCE(SUM(CASE WHEN j.status='posted' AND substr(j.date,1,7)=${month} THEN l.creditMinor ELSE 0 END),0) credit
 FROM GLAccount a LEFT JOIN GLLine l ON l.accountId=a.id LEFT JOIN GLJournal j ON j.id=l.journalId AND j.bookId=a.bookId WHERE a.bookId=${bookId} GROUP BY a.id ORDER BY a.code LIMIT 5001`;
 if(rows.length>5000)throw new TradeError("科目超过当前报告规模限制，未返回截断合计");
 const zero=BigInt(0),positive=(n:bigint)=>n>zero?n:zero;const totals={openingDebit:zero,openingCredit:zero,debit:zero,credit:zero,closingDebit:zero,closingCredit:zero};
 const report=rows.map(r=>{const closing=r.opening+r.debit-r.credit,values={openingDebit:positive(r.opening),openingCredit:positive(-r.opening),debit:r.debit,credit:r.credit,closingDebit:positive(closing),closingCredit:positive(-closing)};for(const key of Object.keys(totals) as Array<keyof typeof totals>)totals[key]+=values[key];return{id:r.id,code:r.code,name:r.name,category:r.category,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,formatMoney(v,book.baseCurrency)]))} as {id:string;code:string;name:string;category:string;openingDebit:string;openingCredit:string;debit:string;credit:string;closingDebit:string;closingCredit:string};});
 return {book,month,rows:report,balanced:totals.openingDebit===totals.openingCredit&&totals.debit===totals.credit&&totals.closingDebit===totals.closingCredit,totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,formatMoney(v,book.baseCurrency)]))};
}
export async function getAccountLedger(actor:TradeActor,bookId:string,accountId:string,month:string,pageInput?:string){
 const trial=await getLedgerTrial(actor,bookId,month),account=trial.rows.find(a=>a.id===accountId);if(!account)throw new TradeError("科目不属于当前账套",404);const page=resourcePage(pageInput);
 const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM GLLine l JOIN GLJournal j ON j.id=l.journalId WHERE l.accountId=${accountId} AND j.bookId=${bookId} AND j.status='posted' AND substr(j.date,1,7)=${month}`,prisma.$queryRaw<Array<{journalId:string;date:string;number:string;summary:string;debitMinor:bigint;creditMinor:bigint;note:string}>>`SELECT j.id journalId,j.date,j.number,j.summary,l.debitMinor,l.creditMinor,l.note FROM GLLine l JOIN GLJournal j ON j.id=l.journalId WHERE l.accountId=${accountId} AND j.bookId=${bookId} AND j.status='posted' AND substr(j.date,1,7)=${month} ORDER BY j.date,j.number,l.lineNo LIMIT 20 OFFSET ${(page-1)*20}`]);
 return {book:trial.book,account,month,page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(r=>({journalId:r.journalId,date:r.date,number:r.number,summary:r.summary,note:r.note,debit:formatMoney(r.debitMinor,trial.book.baseCurrency),credit:formatMoney(r.creditMinor,trial.book.baseCurrency)}))};
}
export async function listTreasury(actor:TradeActor,filter:{kind?:string;page?:string|number;q?:string}={}){
 await requireTrade(actor);const page=resourcePage(filter.page),q=(filter.q??"").trim().slice(0,100),org=actor.organizationId;
 if(filter.kind==="fx"){
  const scope=Prisma.sql`FROM TreasuryFx f JOIN TradeCash s ON s.id=f.sourceCashId AND s.organizationId=f.organizationId WHERE f.organizationId=${org} ${q?Prisma.sql`AND instr(f.bankReference||' '||s.bankReference,${q})>0`:Prisma.empty}`;
  const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),prisma.$queryRaw<Array<{id:string;status:string;sourceReference:string;bankReference:string;fromCurrency:string;toCurrency:string;fromMinor:bigint;toMinor:bigint;feeMinor:bigint;rate:string;rateDate:string;occurredOn:string;basis:string;voidReason:string|null}>>(Prisma.sql`SELECT f.*,s.bankReference sourceReference ${scope} ORDER BY f.createdAt DESC,f.id LIMIT 20 OFFSET ${(page-1)*20}`)]);
  return {kind:"fx" as const,page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(r=>({id:r.id,status:r.status,sourceReference:r.sourceReference,reference:r.bankReference,fromCurrency:r.fromCurrency,toCurrency:r.toCurrency,fromAmount:formatMoney(r.fromMinor,r.fromCurrency),toAmount:formatMoney(r.toMinor,r.toCurrency),fee:formatMoney(r.feeMinor,r.toCurrency),net:formatMoney(r.toMinor-r.feeMinor,r.toCurrency),rate:r.rate,rateDate:r.rateDate,date:r.occurredOn,basis:r.basis,voidReason:r.voidReason}))};
 }
 const scope=Prisma.sql`FROM TreasuryRefund r JOIN TradeCash s ON s.id=r.sourceCashId AND s.organizationId=r.organizationId JOIN cash c ON c.id=r.counterCashId WHERE r.organizationId=${org} ${q?Prisma.sql`AND instr(c.bankReference||' '||s.bankReference||' '||c.partyName,${q})>0`:Prisma.empty}`;
 const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>(Prisma.sql`${cashCte(org)} SELECT COUNT(*) n ${scope}`),prisma.$queryRaw<Array<CashRow&{refundId:string;refundStatus:string;sourceReference:string}>>(Prisma.sql`${cashCte(org)} SELECT c.*,r.id refundId,r.status refundStatus,s.bankReference sourceReference ${scope} ORDER BY r.createdAt DESC,r.id LIMIT 20 OFFSET ${(page-1)*20}`)]);
 return {kind:"refund" as const,page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(r=>({...cashView(r),id:r.refundId,status:r.refundStatus,sourceReference:r.sourceReference}))};
}
