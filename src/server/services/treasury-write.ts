import { createId } from "@/lib/hash";
import { checkDate,dateInZone,parseMoney,convertMoney,normalizeRate,TradeError,MAX_MINOR } from "@/lib/trade-money";
import { cashRow,requireVersion,type TradeDb } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import { TreasuryCommandSchema,type TreasuryCommand } from "./ledger-contract";
import { financialWrite,requireUnpostedSource } from "./ledger-db";
export async function treasuryUsage(db:TradeDb,org:string,id:string){
 const [r]=await db.$queryRaw<Array<{refund:bigint;fx:bigint}>>`SELECT (SELECT COALESCE(SUM(amountMinor),0) FROM TreasuryRefund WHERE organizationId=${org} AND sourceCashId=${id} AND status='active') refund,(SELECT COALESCE(SUM(fromMinor),0) FROM TreasuryFx WHERE organizationId=${org} AND sourceCashId=${id} AND status='active') fx`;return r;
}
export async function ensureCashCanVoid(db:TradeDb,org:string,id:string){
 await requireUnpostedSource(db,org,"cash",id);const used=await treasuryUsage(db,org,id);
 const legs=await db.$queryRaw<Array<{cashId:string}>>`SELECT cashId FROM TreasuryLeg WHERE organizationId=${org} AND cashId=${id}`;
 if(legs.length||used.refund>BigInt(0)||used.fx>BigInt(0))throw new TradeError("流水有关联退款或结汇，请到资金调整核对原记录，不可直接作废");
}
async function insertCash(db:TradeDb,actor:TradeActor,input:{direction:string;partyKind:string;partyId:string;currency:string;amount:bigint;fee:bigint;account:string;reference:string;date:string;basis:string;kind:string;owner:string},now:string){
 const dup=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM TradeCash WHERE organizationId=${actor.organizationId} AND bankAccount=${input.account} AND bankReference=${input.reference} AND direction=${input.direction} AND status='recorded' LIMIT 1`;
 if(dup.length)throw new TradeError("此银行流水号已经登记，不能重复计入资金");
 const id=createId();
 await db.$executeRaw`INSERT INTO TradeCash(id,organizationId,direction,partyKind,partyId,currency,amountMinor,feeMinor,bankAccount,bankReference,occurredOn,basis,status,version,createdBy,createdAt) VALUES(${id},${actor.organizationId},${input.direction},${input.partyKind},${input.partyId},${input.currency},${input.amount},${input.fee},${input.account},${input.reference},${input.date},${input.basis},'recorded',1,${actor.userId},${now})`;
 await db.$executeRaw`INSERT INTO TreasuryLeg(cashId,organizationId,kind,ownerId) VALUES(${id},${actor.organizationId},${input.kind},${input.owner})`;return id;
}
export async function runTreasuryCommand(actor:TradeActor,input:unknown){const parsed=TreasuryCommandSchema.safeParse(input);if(!parsed.success)throw new TradeError(`请检查资金登记：${parsed.error.issues[0].message}`);const c=parsed.data;return financialWrite(actor,"treasury",c,c.action.startsWith("void_")?"treasury_reverse":"treasury_record",(db,now)=>execute(db,actor,c,now));}
async function execute(db:TradeDb,actor:TradeActor,c:TreasuryCommand,now:string){
 const org=actor.organizationId;
 if(c.action==="record_refund"||c.action==="record_fx"){
  const source=await cashRow(db,org,c.sourceCashId);requireVersion(source.version,c.expectedVersion);if(source.status!=="recorded")throw new TradeError("来源流水已作废");
  const [leg]=await db.$queryRaw<Array<{kind:string}>>`SELECT kind FROM TreasuryLeg WHERE organizationId=${org} AND cashId=${source.id}`;
  const company=await db.organization.findUniqueOrThrow({where:{id:org}}),today=dateInZone(new Date(now),company.timezone),date=checkDate(c.occurredOn);
  if(date>today||date<source.occurredOn)throw new TradeError("资金调整日期不能早于来源流水或晚于今天");
  const usage=await treasuryUsage(db,org,source.id),amount=parseMoney(c.amount,source.currency),id=createId();
  if(c.action==="record_refund"){
   if(leg||!["customer","party"].includes(source.partyKind))throw new TradeError("退款须关联原始客户收款或供应商付款");
   if(amount>source.availableMinor||amount>source.amountMinor-usage.refund-usage.fx)throw new TradeError("退款超过未核销或未兑换的来源余额；已结汇部分须另行核对退款资金来源");
   const fee=parseMoney(c.fee,source.currency,{zero:true}),direction=source.direction==="receive"?"pay":"receive";
   if(amount+fee>MAX_MINOR||(direction==="receive"&&fee>=amount))throw new TradeError("退款手续费或净金额无效");
   const counter=await insertCash(db,actor,{direction,partyKind:source.partyKind,partyId:source.partyId,currency:source.currency,amount,fee,account:c.bankAccount,reference:c.bankReference,date,basis:c.basis,kind:"refund",owner:id},now);
   await db.$executeRaw`INSERT INTO TreasuryRefund(id,organizationId,sourceCashId,counterCashId,amountMinor,status,basis,createdBy,createdAt) VALUES(${id},${org},${source.id},${counter},${amount},'active',${c.basis},${actor.userId},${now})`;
   await db.$executeRaw`UPDATE TradeCash SET version=version+1 WHERE id=${source.id} AND organizationId=${org}`;
   return {id,summary:`登记${source.direction==="receive"?"客户退款":"供应商退回款"} ${source.currency} ${c.amount}，独立反向流水已留存，未发起银行支付`};
  }
  if(source.direction!=="receive"||source.currency===c.toCurrency)throw new TradeError("结汇须选来源收款且买入、卖出币种不同");
  if(amount>source.amountMinor-source.feeMinor-usage.refund-usage.fx)throw new TradeError("结汇超过本来源尚未兑换的净金额");
  const rate=normalizeRate(c.rate),rateDate=checkDate(c.rateDate),toAmount=convertMoney(amount,source.currency,c.toCurrency,rate),fee=parseMoney(c.fee,c.toCurrency,{zero:true});
  if(rateDate>today||fee>=toAmount)throw new TradeError("汇率日期或结汇手续费无效");
  const out=await insertCash(db,actor,{direction:"pay",partyKind:"internal",partyId:org,currency:source.currency,amount,fee:BigInt(0),account:source.bankAccount,reference:`${c.bankReference}/OUT`,date,basis:c.basis,kind:"fx_out",owner:id},now);
  const incoming=await insertCash(db,actor,{direction:"receive",partyKind:"internal",partyId:org,currency:c.toCurrency,amount:toAmount,fee,account:c.toAccount,reference:`${c.bankReference}/IN`,date,basis:c.basis,kind:"fx_in",owner:id},now);
  await db.$executeRaw`INSERT INTO TreasuryFx(id,organizationId,sourceCashId,outCashId,inCashId,fromCurrency,toCurrency,fromMinor,toMinor,feeMinor,rate,rateDate,occurredOn,bankReference,basis,status,createdBy,createdAt) VALUES(${id},${org},${source.id},${out},${incoming},${source.currency},${c.toCurrency},${amount},${toAmount},${fee},${rate},${rateDate},${date},${c.bankReference},${c.basis},'active',${actor.userId},${now})`;
  await db.$executeRaw`UPDATE TradeCash SET version=version+1 WHERE id=${source.id} AND organizationId=${org}`;
  return {id,summary:`登记 ${source.currency} ${c.amount} 结汇/换汇至 ${c.toCurrency}，业务核销余额保持独立`};
 }
 const type=c.action==="void_refund"?"refund":"fx";
 await requireUnpostedSource(db,org,type,c.id);
 const rows=type==="refund"?await db.$queryRaw<Array<{sourceCashId:string;status:string;counterCashId:string}>>`SELECT sourceCashId,status,counterCashId FROM TreasuryRefund WHERE organizationId=${org} AND id=${c.id}`:await db.$queryRaw<Array<{sourceCashId:string;status:string;outCashId:string;inCashId:string}>>`SELECT sourceCashId,status,outCashId,inCashId FROM TreasuryFx WHERE organizationId=${org} AND id=${c.id}`;
 const record=rows[0];if(!record||record.status!=="active")throw new TradeError("资金调整不存在或已更正");
 const ids="counterCashId" in record?[record.counterCashId]:[record.outCashId,record.inCashId];
 for(const id of ids){await requireUnpostedSource(db,org,"cash",id);const used=await treasuryUsage(db,org,id);if(used.refund>BigInt(0)||used.fx>BigInt(0))throw new TradeError("后续资金调整尚未处理，不能作废来源");const cash=await cashRow(db,org,id);if(cash.allocatedMinor>BigInt(0))throw new TradeError("后续核销尚未处理");await db.$executeRaw`UPDATE TradeCash SET status='void',voidReason=${c.reason},version=version+1 WHERE id=${id} AND organizationId=${org}`;}
 if(type==="refund")await db.$executeRaw`UPDATE TreasuryRefund SET status='void',voidReason=${c.reason} WHERE id=${c.id} AND organizationId=${org}`;
 else await db.$executeRaw`UPDATE TreasuryFx SET status='void',voidReason=${c.reason} WHERE id=${c.id} AND organizationId=${org}`;
 await db.$executeRaw`UPDATE TradeCash SET version=version+1 WHERE id=${record.sourceCashId} AND organizationId=${org}`;
 return {id:c.id,summary:`更正误登记的${type==="refund"?"退款":"结汇"}记录，原记录保留；不撤销银行交易`};
}
