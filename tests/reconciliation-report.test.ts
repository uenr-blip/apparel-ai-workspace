import { beforeEach, describe, it, expect, vi } from "vitest";
import { prisma, getPrisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { getReconciliationReport, getReconciliationLines } from "@/server/services/reconciliation-report";
import { saveReconciliationRule } from "@/server/services/reconciliation-rules";
import { runLedgerCommand } from "@/server/services/ledger-write";
import { runTradeCommand } from "@/server/services/trade-write";
import { setUserPermission } from "@/server/services/user-permissions";
import { resetDatabase } from "./helpers";
const manager={organizationId:IDS.orgDemo,userId:IDS.userManager,role:"manager",factoryId:null}, reviewer={...manager,userId:IDS.userSales,role:"salesperson"};
let n=0;
const gl=(data:Record<string,unknown>,actor=manager)=>runLedgerCommand(actor,{...data,idempotencyKey:`amount-gl-${++n}`});
const trade=(data:Record<string,unknown>)=>runTradeCommand(manager,{...data,idempotencyKey:`amount-trade-${++n}`});
async function setup(){
 const b=await gl({action:"create_book",name:`金额验收${++n}`,baseCurrency:"CNY",startMonth:"2026-09"});
 for(const action of ["ledger_view","ledger_review"])await setUserPermission({organizationId:manager.organizationId,managerId:manager.userId,targetUserId:reviewer.userId,action,enabled:true});
 const a=await prisma.gLAccount.findMany({where:{bookId:b.id}}),account=(code:string)=>a.find(x=>x.code===code)!.id;
 return {bookId:b.id,account,accounts:{receivable:[account("A-AR")],payable:[account("L-AP")],funds:[account("A-BANK")],cost:[account("X-COST")]}};
}
async function rule(s:Awaited<ReturnType<typeof setup>>,rates:Array<{currency:string;rate:string;date:string;basis:string}>=[],version=0){
 return saveReconciliationRule(manager,{action:"save_reconciliation_rule",bookId:s.bookId,accounts:s.accounts,rates,basis:"仅隔离演示核对，不作正式会计政策",expectedVersion:version,idempotencyKey:`rule-${++n}`});
}
async function payable(currency="CNY"){
 const b=await trade({action:"create_bill",orderId:"order-demo-005",direction:"payable",partyId:IDS.supplierQinghe,title:`验收应付${++n}`,category:"other",currency,amount:"100",dueDate:"2026-09-20",basis:"虚构"});
 await trade({action:"confirm_bill",id:b.id,expectedVersion:1});return b.id;
}
async function source(s:Awaited<ReturnType<typeof setup>>,id:string,type="bill",rate="1"){
 return gl({action:"from_source",bookId:s.bookId,date:"2026-09-20",sourceType:type,sourceId:id,debitAccountId:s.account(type==="cash"?"A-BANK":"A-INVENTORY"),creditAccountId:s.account(type==="cash"?"A-AR":"L-AP"),rate,rateDate:"2026-09-20",basis:"明确隔离折算依据"});
}
async function post(id:string){await gl({action:"review_journal",id,expectedVersion:1},reviewer);await gl({action:"post_journal",id,expectedVersion:2});}
describe("业务金额与总账核对",()=>{
 beforeEach(resetDatabase);
 it("不猜科目映射，草稿不算已入账，过账后与业务应付一致",async()=>{
  const s=await setup(),id=await payable();
  expect((await getReconciliationReport(manager,s.bookId)).rows.find(r=>r.role==="payable")?.status).toBe("unmapped");
  await rule(s);const j=await source(s,id);
  const before=await getReconciliationReport(manager,s.bookId);expect(before.rows.find(r=>r.role==="payable")).toMatchObject({business:"100.00",actual:"0.00",difference:"-100.00",status:"difference"});expect(before.sourceReport.counts.pending).toBe(1);
  await post(j.id);const after=await getReconciliationReport(manager,s.bookId);expect(after.rows.find(r=>r.role==="payable")).toMatchObject({actual:"100.00",difference:"0.00",status:"matched"});expect(after.sourceReport.rows[0]).toMatchObject({expected:"100.00",frozen:"100.00",actual:"100.00",status:"matched"});
 });
 it("外币缺汇率不补零，改核对汇率只显示差异，不修改凭证",async()=>{
  const s=await setup(),id=await payable("USD"),j=await source(s,id,"bill","7");await post(j.id);await rule(s);
  expect((await getReconciliationReport(manager,s.bookId)).rows.find(r=>r.role==="payable")).toMatchObject({business:null,difference:null,status:"needs_rate",missingRates:["USD"]});
  await rule(s,[{currency:"USD",rate:"7",date:"2026-09-20",basis:"演示对照"}],1);
  expect((await getReconciliationReport(manager,s.bookId)).rows.find(r=>r.role==="payable")?.difference).toBe("0.00");
  await rule(s,[{currency:"USD",rate:"7.1",date:"2026-09-20",basis:"仅改变对照口径"}],2);
  const report=await getReconciliationReport(manager,s.bookId);expect(report.rows.find(r=>r.role==="payable")?.difference).toBe("-10.00");expect(report.sourceReport.rows[0].status).toBe("matched");
  expect((await prisma.gLJournal.findUniqueOrThrow({where:{id:j.id}})).expectedTotalMinor).toBe(BigInt(70000));
 });
 it("手工资金期初另列，不能把已登记净变动叫银行余额",async()=>{
  const s=await setup();await rule(s);
  const opening=await gl({action:"save_journal",bookId:s.bookId,date:"2026-09-20",summary:"演示期初",basis:"明确人工期初",expectedVersion:0,lines:[{accountId:s.account("A-BANK"),debit:"1000",credit:"0",note:""},{accountId:s.account("E-EQUITY"),debit:"0",credit:"1000",note:""}]});await post(opening.id);
  const c=await trade({action:"record_cash",direction:"receive",partyId:"customer-qinglan",currency:"CNY",amount:"100",fee:"0",bankAccount:"演示银行",bankReference:"AMOUNT-CASH",occurredOn:"2026-09-20",basis:"登记事实"});
  const j=await source(s,c.id,"cash");await post(j.id);
  const report=await getReconciliationReport(manager,s.bookId);expect(report.rows.find(r=>r.role==="funds")).toMatchObject({business:"100.00",actual:"100.00",manualAmount:"1000.00",status:"manual_review"});
  const lines=await getReconciliationLines(manager,s.bookId,"funds");expect(lines.rows.some(l=>l.id===opening.id&&l.excluded)).toBe(true);
 });
 it("冲销后净额归零且提示待核对，重制单不把原单重复累计",async()=>{
  const s=await setup(),id=await payable();await rule(s);const j=await source(s,id);await post(j.id);
  const reverse=await gl({action:"reverse_journal",id:j.id,expectedVersion:3,date:"2026-09-20",reason:"演示更正"});await post(reverse.id);
  let report=await getReconciliationReport(manager,s.bookId);expect(report.rows.find(r=>r.role==="payable")?.actual).toBe("0.00");expect(report.sourceReport.rows[0]).toMatchObject({status:"reversed",actual:"0.00"});
  const next=await source(s,id);await post(next.id);report=await getReconciliationReport(manager,s.bookId);expect(report.rows.find(r=>r.role==="payable")?.actual).toBe("100.00");expect(report.sourceReport.counts.matched).toBe(1);
 });
 it("独立复算发现被破坏的分录和留存总额，不只检查借贷平衡",async()=>{
  const s=await setup(),id=await payable();await rule(s);const j=await source(s,id);await post(j.id);
  await prisma.gLLine.updateMany({where:{journalId:j.id,debitMinor:{gt:0}},data:{debitMinor:BigInt(10500)}});
  await prisma.gLLine.updateMany({where:{journalId:j.id,creditMinor:{gt:0}},data:{creditMinor:BigInt(10500)}});
  let report=await getReconciliationReport(manager,s.bookId);expect(report.sourceReport.rows[0]).toMatchObject({status:"difference",difference:"5.00"});
  await prisma.gLJournal.update({where:{id:j.id},data:{expectedTotalMinor:BigInt(10500)}});
  report=await getReconciliationReport(manager,s.bookId);expect(report.sourceReport.rows[0].status).toBe("invalid");
 });
 it("配置拒绝重复科目、外账簿和旧版本，查阅与配置权限分开",async()=>{
  const s=await setup();await expect(saveReconciliationRule(manager,{action:"save_reconciliation_rule",bookId:s.bookId,accounts:{...s.accounts,funds:s.accounts.receivable},rates:[],basis:"无效",expectedVersion:0,idempotencyKey:"dup"})).rejects.toThrow(/重复/);
  const other=await setup();await expect(rule({...s,accounts:{...s.accounts,payable:other.accounts.payable}})).rejects.toThrow(/科目/);
  await rule(s);await expect(rule(s)).rejects.toThrow(/版本/);
  await expect(getReconciliationReport(reviewer,s.bookId)).rejects.toThrow(/无权/);
  await setUserPermission({organizationId:manager.organizationId,managerId:manager.userId,targetUserId:reviewer.userId,action:"trade_view",enabled:true});
  expect((await getReconciliationReport(reviewer,s.bookId)).book.id).toBe(s.bookId);
  await expect(saveReconciliationRule(reviewer,{action:"save_reconciliation_rule",bookId:s.bookId,accounts:s.accounts,rates:[],basis:"越权",expectedVersion:1,idempotencyKey:"denied"})).rejects.toThrow(/无权/);
  await expect(getReconciliationReport({...manager,organizationId:"other"},s.bookId)).rejects.toThrow(/无权/);
 });
 it("来源筛选分页前完成全量计数，不把21条截成20条",async()=>{
  const s=await setup();for(let i=0;i<21;i++)await payable();const report=await getReconciliationReport(manager,s.bookId,{state:"pending",page:2});
  expect(report.sourceReport.total).toBe(21);expect(report.sourceReport.rows).toHaveLength(1);expect(report.sourceReport.counts.pending).toBe(21);
 });
 it("来源金额漂移既标明变化，也列出可计算的金额差值",async()=>{
  const s=await setup(),id=await payable();await rule(s);const j=await source(s,id);await post(j.id);
  await prisma.tradeBill.update({where:{id},data:{amountMinor:BigInt(10500)}});
  const row=(await getReconciliationReport(manager,s.bookId)).sourceReport.rows[0];
  expect(row).toMatchObject({status:"source_changed",expected:"105.00",actual:"100.00",difference:"-5.00"});
 });
 it("超过报告边界明确拒绝，不输出截断后的对平结果",async()=>{
  const s=await setup();
  await prisma.tradeBill.createMany({data:Array.from({length:5001},(_,i)=>({id:`volume-bill-${i}`,organizationId:manager.organizationId,orderId:"order-demo-005",direction:"payable",partyKind:"party",partyId:IDS.supplierQinghe,title:"规模边界",category:"other",currency:"CNY",amountMinor:BigInt(1),dueDate:"2026-09-20",basis:"仅隔离规模测试",status:"confirmed",createdBy:manager.userId,createdAt:new Date().toISOString()}))});
  await expect(getReconciliationReport(manager,s.bookId)).rejects.toThrow(/5000|截断/);
 });
 it("兼容运行中没有新GL模型接口的Prisma实例，不要求重启服务",async()=>{
  const s=await setup(),id=await payable(),j=await source(s,id);await post(j.id);
  const client=getPrisma(),original=client.$transaction.bind(client);
  const spy=vi.spyOn(client,"$transaction").mockImplementation(((input:unknown,options:unknown)=>{
    if(typeof input!=="function")return original(input as never,options as never);
    return original(async db=>input(new Proxy(db,{get(target,property){
      if(typeof property==="string"&&property.startsWith("gL"))throw new Error("旧实例没有GL模型接口");
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    }})),options as never);
  }) as typeof client.$transaction);
  try{await rule(s);expect((await getReconciliationReport(manager,s.bookId)).rows.find(r=>r.role==="payable")?.difference).toBe("0.00");}
  finally{spy.mockRestore();}
 });
});
