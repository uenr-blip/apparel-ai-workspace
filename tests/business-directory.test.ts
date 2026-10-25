import { beforeEach,expect,it } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { searchBusiness } from "@/server/services/business-search";
import { getPartnerDossier } from "@/server/services/partner-dossier";
import { runMaterialCommand } from "@/server/services/material-write";
import { getMaterialReceipt } from "@/server/services/material-read";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { resetDatabase } from "./helpers";
const manager={organizationId:IDS.orgDemo,userId:IDS.userManager,role:"manager",factoryId:null};
const sales={...manager,userId:IDS.userSales,role:"salesperson"};
const factory={...manager,userId:IDS.userFactory,role:"factory",factoryId:IDS.factoryYunshan};
beforeEach(resetDatabase);
it("一个汉字跨款式材料匹配，DEV编号不分大小写，超出候选有完整分页，特殊字符不能变成查询指令",async()=>{
 const style=await prisma.style.findUniqueOrThrow({where:{id:IDS.styleSt26018}});await prisma.style.create({data:{...style,id:"search-sweater",code:"QA-WOOL",name:"毛衣测试"}});
 await prisma.material.create({data:{id:"search-yarn",organizationId:IDS.orgDemo,code:"QA-YARN",name:"测试纱线",kind:"yarn",specSummary:"2/48",composition:"羊毛",unit:"kg",demoNote:"test"}});
 await prisma.developmentProject.createMany({data:Array.from({length:25},(_,i)=>({id:`search-dev-${i}`,organizationId:IDS.orgDemo,code:`DEV-02${String(i).padStart(2,"0")}`,name:"毛衣开发",status:"open",unknownsJson:"[]"}))});
 const result=await searchBusiness(sales,"毛",{suggest:true});expect(result.items.some(r=>r.id==="search-sweater")).toBe(true);expect(result.items.some(r=>r.id==="search-yarn")).toBe(true);expect(result.items.filter(r=>r.kind==="project")).toHaveLength(6);
 const first=await searchBusiness(sales,"dev-02",{kind:"project"}),second=await searchBusiness(sales,"DEV-02",{kind:"project",page:2});expect(first.total).toBe(25);expect(second.items).toHaveLength(5);expect(new Set([...first.items,...second.items].map(r=>r.id)).size).toBe(25);
 expect((await searchBusiness(sales,"' OR 1=1 --")).total).toBe(0);expect((await searchBusiness(sales," ")).total).toBe(0);
});
it("搜索和伙伴详情隔离公司、工厂和失效账号",async()=>{
 const own=await searchBusiness(factory,"DEMO",{kind:"order"});for(const row of own.items)expect((await prisma.salesOrder.findUniqueOrThrow({where:{id:row.id}})).factoryId).toBe(IDS.factoryYunshan);
 expect((await searchBusiness(factory,"",{kind:"customer",allowEmpty:true})).total).toBe(0);expect((await searchBusiness(factory,"",{kind:"supplier",allowEmpty:true})).total).toBe(0);
 await expect(getPartnerDossier(factory,"customer",IDS.customerNorthshore)).rejects.toThrow(/无权/);await expect(getPartnerDossier(sales,"supplier",IDS.supplierQinghe)).rejects.toThrow();
 await expect(searchBusiness({...sales,organizationId:IDS.orgIso},"毛")).rejects.toThrow(/无权/);
 await prisma.user.update({where:{id:sales.userId},data:{active:false}});await expect(searchBusiness(sales,"DEMO")).rejects.toThrow(/无权/);
});
it("客户按真实订单品牌和历史归类，部分出运不能判整单已完成，查阅不写业务",async()=>{
 await prisma.styleOption.create({data:{id:"qa-brand",organizationId:IDS.orgDemo,kind:"brand",name:"验收品牌"}});
 await prisma.style.update({where:{id:IDS.styleSt26018},data:{brandOptionId:"qa-brand"}});
 await prisma.salesOrder.create({data:{id:"qa-partial",organizationId:IDS.orgDemo,orderNo:"QA-PARTIAL",customerId:IDS.customerNorthshore,factoryId:IDS.factoryYunshan,status:"in_production",productionReadiness:"partial_shipped",lines:{create:{id:"qa-partial-line",styleId:IDS.styleSt26018,totalQuantity:100}}}});
 await prisma.productionQty.createMany({data:["started","good","shipped"].map(kind=>({id:`qa-${kind}`,orderId:"qa-partial",kind,quantity:20,idempotencyKey:`qa-${kind}`}))});
 await prisma.taskItem.create({data:{id:"qa-block",organizationId:IDS.orgDemo,title:"还需补齐余下80件",kind:"missing_approval",status:"open",blocking:true,relatedOrderId:"qa-partial"}});
 const audits=await prisma.auditEvent.count();const current=await getPartnerDossier(sales,"customer",IDS.customerNorthshore,{brandId:"qa-brand"});
 expect(current.brands.some(b=>b.name==="验收品牌")).toBe(true);expect(current.orders.find(o=>o.id==="qa-partial")).toMatchObject({ordered:100,shipped:20,blockers:["还需补齐余下80件"]});
 const history=await getPartnerDossier(sales,"customer",IDS.customerNorthshore,{group:"history"});expect(history.orders.some(o=>o.id==="qa-partial")).toBe(false);expect(await prisma.auditEvent.count()).toBe(audits);
 await prisma.productionQty.create({data:{id:"qa-ship-rest",orderId:"qa-partial",kind:"shipped",quantity:80,idempotencyKey:"qa-rest"}});
 expect((await getPartnerDossier(sales,"customer",IDS.customerNorthshore,{group:"history"})).orders.some(o=>o.id==="qa-partial")).toBe(true);
});
it("供应商只按明确收料凭证关联订单，退供和冲销保留历史，不从同料报价推断采购",async()=>{
 const receive=await runMaterialCommand(manager,{action:"receive",orderId:"order-demo-005",supplierId:IDS.supplierQinghe,materialId:IDS.materialD06,locationId:IDS.warehouse,colorName:"本色",qty:"100",reference:"QA-RECEIPT",occurredOn:"2026-09-18",basis:"隔离测试实际收料",idempotencyKey:"qa-receipt"});
 const receipt=await getMaterialReceipt(manager,receive.id);await runMaterialCommand(manager,{action:"return_supplier",id:receive.id,lotId:receipt.lotId,qty:"20",basis:"退供测试",idempotencyKey:"qa-return"});
 const data=await getPartnerDossier(manager,"supplier",IDS.supplierQinghe,{group:"all"});expect(data.receipts.find(r=>r.id===receive.id)).toMatchObject({quantity:"100",returned:"20",netQuantity:"80"});expect(data.orders.map(o=>o.id)).toEqual(["order-demo-005"]);expect(data.notes.join(" ")).toContain("不能据同一种材料推断");
});
it("工作台智能体查客户现况使用伙伴工具，不强制套交期查询，所有业务查询只读",async()=>{
 const customer=await prisma.customer.findUniqueOrThrow({where:{id:IDS.customerNorthshore}});let n=0;
 const calls=[{name:"find_partner",args:{query:customer.code,kind:"customer"}},{name:"read_partner",args:{id:customer.id,group:"all",page:1}}];
 const before=await prisma.salesOrder.count();const result=await runBusinessAgent(sales,"workspace",`查${customer.name}的当前订单和历史`,async()=>{const step=calls[n++];return step?{content:null,tool_calls:[{id:`qa-call-${n}`,type:"function",function:{name:step.name,arguments:JSON.stringify(step.args)}}]}:{content:"已列出客户现况与历史，请按原单核对。"};});
 expect(result.tables.some(t=>t.title.includes("订单与进展"))).toBe(true);expect(result.evidenceRead).toBe(true);expect(await prisma.salesOrder.count()).toBe(before);
});
