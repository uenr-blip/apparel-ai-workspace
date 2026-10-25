import { cashRow,billRow,type TradeDb } from "./trade-db";
import { TradeError,parseMoney,convertMoney,formatMoney,normalizeRate,checkDate } from "@/lib/trade-money";
import type { TradeActor } from "./trade-contract";
import type { LedgerCommand } from "./ledger-contract";
import type { BookRow } from "./ledger-db";
import { ensureLedgerBusinessSource } from "./ledger-business-check";
export async function readLedgerSource(db:TradeDb,org:string,type:string,id:string):Promise<{facts:Record<string,unknown>;currency:string;amount:bigint;fee:bigint;direction:string;negative:boolean;claims:Array<{type:string;id:string}>;fx?:{toCurrency:string;toMinor:bigint;feeMinor:bigint}}> {
 if(type==="bill"||type==="adjustment"){
  let billId=id,delta:bigint|null=null,adjustment:Record<string,unknown>|null=null;
  if(type==="adjustment"){const [a]=await db.$queryRaw<Array<{id:string;billId:string;amountMinor:bigint;reason:string;createdAt:string}>>`SELECT id,billId,amountMinor,reason,createdAt FROM TradeAdjustment WHERE organizationId=${org} AND id=${id}`;if(!a)throw new TradeError("扣补来源不存在",404);billId=a.billId;delta=a.amountMinor;adjustment={id:a.id,amount:String(a.amountMinor),reason:a.reason,createdAt:a.createdAt};}
  const b=await billRow(db,org,billId);if(b.status!=="confirmed")throw new TradeError("只有已确认的业务单据可以制单");
  const amount=delta??b.amountMinor;
  return {facts:{type,id,billId:b.id,status:b.status,direction:b.direction,partyId:b.partyId,currency:b.currency,originalAmount:String(b.amountMinor),title:b.title,adjustment},currency:b.currency,amount:amount<BigInt(0)?-amount:amount,fee:BigInt(0),direction:b.direction,negative:amount<BigInt(0),claims:[{type,id}]};
 }
 if(type==="cash"||type==="refund"){
  let cashId=id,refund:Record<string,unknown>|null=null;
  if(type==="refund"){const [r]=await db.$queryRaw<Array<{id:string;sourceCashId:string;counterCashId:string;status:string;basis:string}>>`SELECT id,sourceCashId,counterCashId,status,basis FROM TreasuryRefund WHERE organizationId=${org} AND id=${id}`;if(!r||r.status!=="active")throw new TradeError("退款来源不存在或已更正");cashId=r.counterCashId;refund=r;}
  const c=await cashRow(db,org,cashId);if(c.status!=="recorded")throw new TradeError("资金来源已作废");
  if(type==="cash"&&c.cashKind)throw new TradeError("资金调整的内部流水请从退款/结汇来源整体制单，避免重复");
  return {facts:{type,id,refund,cashId:c.id,direction:c.direction,partyKind:c.partyKind,partyId:c.partyId,currency:c.currency,amount:String(c.amountMinor),fee:String(c.feeMinor),account:c.bankAccount,reference:c.bankReference,occurredOn:c.occurredOn,status:c.status},currency:c.currency,amount:c.amountMinor,fee:c.feeMinor,direction:c.direction,negative:false,claims:type==="refund"?[{type,id},{type:"cash",id:cashId}]:[{type,id}]};
 }
 if(type==="fx"){
  const [f]=await db.$queryRaw<Array<{id:string;status:string;sourceCashId:string;outCashId:string;inCashId:string;fromCurrency:string;toCurrency:string;fromMinor:bigint;toMinor:bigint;feeMinor:bigint;rate:string;rateDate:string;occurredOn:string;basis:string;bankReference:string}>>`SELECT * FROM TreasuryFx WHERE organizationId=${org} AND id=${id}`;
  if(!f||f.status!=="active")throw new TradeError("结汇来源不存在或已更正");
  return {facts:{type,id,status:f.status,sourceCashId:f.sourceCashId,outCashId:f.outCashId,inCashId:f.inCashId,fromCurrency:f.fromCurrency,toCurrency:f.toCurrency,fromMinor:String(f.fromMinor),toMinor:String(f.toMinor),feeMinor:String(f.feeMinor),rate:f.rate,rateDate:f.rateDate,occurredOn:f.occurredOn,reference:f.bankReference,basis:f.basis},currency:f.fromCurrency,amount:f.fromMinor,fee:f.feeMinor,direction:"fx",negative:false,claims:[{type,id},{type:"cash",id:f.outCashId},{type:"cash",id:f.inCashId}],fx:{toCurrency:f.toCurrency,toMinor:f.toMinor,feeMinor:f.feeMinor}};
 }
 throw new TradeError("不支持的凭证来源");
}
export async function buildSourceLines(db:TradeDb,actor:TradeActor,book:BookRow,c:Extract<LedgerCommand,{action:"from_source"}>){
 await ensureLedgerBusinessSource(db,actor,c.sourceType,c.sourceId);
 const source=await readLedgerSource(db,actor.organizationId,c.sourceType,c.sourceId),lines:Array<{accountId:string;debit:string;credit:string;note:string}>=[];
 const push=(accountId:string,debit:bigint,credit:bigint,note:string)=>{if(debit===BigInt(0)&&credit===BigInt(0))return;if(!accountId)throw new TradeError("请补充手续费或汇兑差额科目");lines.push({accountId,debit:formatMoney(debit,book.baseCurrency),credit:formatMoney(credit,book.baseCurrency),note});};
 checkDate(c.rateDate);
 if(typeof source.facts.occurredOn === "string" && c.date < source.facts.occurredOn)throw new TradeError("\u5165\u8d26\u65e5\u671f\u4e0d\u80fd\u65e9\u4e8e\u5b9e\u9645\u6536\u4ed8\u65e5\u671f");
 if(source.fx){
  if(source.fx.toCurrency!==book.baseCurrency)throw new TradeError("本轮结汇制单要求买入币种与账套本位币一致；其他组合请财务人工制单");
  const carrying=parseMoney(c.carryingAmount,book.baseCurrency),received=source.fx.toMinor,fee=source.fx.feeMinor;
  push(c.debitAccountId,received-fee,BigInt(0),"买入币种银行净额");push(c.feeAccountId,fee,BigInt(0),"银行手续费");push(c.creditAccountId,BigInt(0),carrying,"财务核对的外币账面金额");
  if(carrying>received)push(c.gainLossAccountId,carrying-received,BigInt(0),"本次兑换差额");else push(c.gainLossAccountId,BigInt(0),received-carrying,"本次兑换差额");
 }else{
  const rate=source.currency===book.baseCurrency?"1":normalizeRate(c.rate);
  if(source.currency===book.baseCurrency&&c.rate&&normalizeRate(c.rate)!=="1")throw new TradeError("本位币制单汇率必须为1");
  const amount=convertMoney(source.amount,source.currency,book.baseCurrency,rate),fee=source.fee===BigInt(0)?BigInt(0):convertMoney(source.fee,source.currency,book.baseCurrency,rate);
  if(source.direction==="receive"){if(fee>=amount)throw new TradeError("折算后手续费覆盖本金");push(c.debitAccountId,amount-fee,BigInt(0),"收款净额");push(c.feeAccountId,fee,BigInt(0),"手续费");push(c.creditAccountId,BigInt(0),amount,"收款对方");}
  else if(source.direction==="pay"){push(c.debitAccountId,amount,BigInt(0),"付款对方");push(c.feeAccountId,fee,BigInt(0),"手续费");push(c.creditAccountId,BigInt(0),amount+fee,"银行支出");}
  else if(source.negative){push(c.creditAccountId,amount,BigInt(0),"负向扣补借方");push(c.debitAccountId,BigInt(0),amount,"负向扣补贷方");}
  else{push(c.debitAccountId,amount,BigInt(0),"业务单据借方");push(c.creditAccountId,BigInt(0),amount,"业务单据贷方");}
 }
 return {source,lines,total:lines.reduce((sum,line)=>sum+parseMoney(line.debit,book.baseCurrency,{zero:true}),BigInt(0))};
}
