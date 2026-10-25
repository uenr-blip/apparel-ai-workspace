import { beforeEach, describe, expect, it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { runMaterialCommand } from "@/server/services/material-write";
import { getMaterialReceipt, getOrderCosts } from "@/server/services/material-read";
import { transferInventory, consumeInventory } from "@/server/services/inventory-move";
import { runTradeCommand } from "@/server/services/trade-write";
import { getTradeBill } from "@/server/services/trade-read";
import { resetDatabase } from "./helpers";
import { setUserPermission } from "@/server/services/user-permissions";
import { getLotLedger } from "@/server/services/inventory-query";
const actor = { organizationId: IDS.orgDemo, userId: IDS.userManager, role: "manager", factoryId: null };
let n=0;
const run = (data: Record<string, unknown>) => runMaterialCommand(actor,{...data,idempotencyKey:data.idempotencyKey ?? `material-${++n}`});
async function receive() {
  const result = await run({action:"receive",orderId:"order-demo-005",supplierId:IDS.supplierQinghe,materialId:IDS.materialD06,locationId:IDS.warehouse,colorName:"本色",qty:"100",reference:`DN-${++n}`,occurredOn:"2026-09-18",basis:"实际收料并验收放行"});
  await run({action:"value_receipt",id:result.id,expectedVersion:1,currency:"CNY",unitPrice:"2.50",basis:"供应商确认单价"});
  return getMaterialReceipt(actor,result.id);
}
describe("实物凭证与订单成本",()=>{
  beforeEach(resetDatabase);
  it("收料→应付→调拨→按单耗用→未耗用退回→订单成本",async()=>{
    const receipt=await receive();
    const payable=await runTradeCommand(actor,{action:"create_bill",orderId:"order-demo-005",direction:"payable",partyId:IDS.supplierQinghe,title:"收料款",category:"materials",currency:"CNY",amount:"250",dueDate:"2026-09-25",basis:"按收料数量与单价核对",sourceKind:"receipt",sourceId:receipt.id,idempotencyKey:"ap-receipt"});
    await runTradeCommand(actor,{action:"confirm_bill",id:payable.id,expectedVersion:1,idempotencyKey:"ap-confirm"});
    const transfer=await transferInventory({...actor,lotId:receipt.lotId,qty:"60",toLocationId:IDS.factoryYunshan,idempotencyKey:"cost-transfer"});
    const use=await consumeInventory({...actor,lotId:transfer.toLotId!,orderId:"order-demo-005",qty:"40",idempotencyKey:"cost-use"});
    expect((await getOrderCosts(actor,"order-demo-005")).currencies[0].materials).toBe("100.00");
    await run({action:"return_use",id:use.movement.id,qty:"10",basis:"未耗用余料退回本批次"});
    expect((await getOrderCosts(actor,"order-demo-005")).currencies[0].materials).toBe("75.00");
    expect((await prisma.inventoryLot.findUniqueOrThrow({where:{id:transfer.toLotId!}})).qtyOnHand).toBe("30");
    expect((await getTradeBill(actor,payable.id)).amount).toBe("250.00");
  });
  it("退供产生应付差异，核对后扣减；冲销退供恢复原依据",async()=>{
    const receipt=await receive();
    const ap=await runTradeCommand(actor,{action:"create_bill",orderId:"order-demo-005",direction:"payable",partyId:IDS.supplierQinghe,title:"收料款",category:"materials",currency:"CNY",amount:"250",dueDate:"2026-09-25",basis:"收料依据",sourceKind:"receipt",sourceId:receipt.id,idempotencyKey:"return-ap"});
    await runTradeCommand(actor,{action:"confirm_bill",id:ap.id,expectedVersion:1,idempotencyKey:"return-ap-confirm"});
    const returned=await run({action:"return_supplier",id:receipt.id,lotId:receipt.lotId,qty:"20",basis:"供应商确认退料"});
    let fresh=await getMaterialReceipt(actor,receipt.id);expect(fresh.netAmount).toBe("200.00");
    await run({action:"sync_payable",id:receipt.id,expectedVersion:fresh.version,billId:ap.id,expectedBillVersion:2,basis:"核对退料20米扣50元"});
    expect((await getTradeBill(actor,ap.id)).amount).toBe("200.00");
    await run({action:"reverse_event",id:returned.id,basis:"实际没有退供，更正凭证"});
    fresh=await getMaterialReceipt(actor,receipt.id);expect(fresh.netAmount).toBe("250.00");
  });
  it("批次余料可以用于另一订单，成本不重复计入采购关联单",async()=>{
    const receipt=await receive();const moved=await transferInventory({...actor,lotId:receipt.lotId,toLocationId:IDS.factoryYunshan,qty:"100",idempotencyKey:"shared-transfer"});
    await consumeInventory({...actor,lotId:moved.toLotId!,orderId:"order-demo-005",qty:"10.5",idempotencyKey:"shared-use1"});
    await consumeInventory({...actor,lotId:moved.toLotId!,orderId:"order-demo-008",qty:"20",idempotencyKey:"shared-use2"});
    expect((await getOrderCosts(actor,"order-demo-005")).currencies[0].materials).toBe("26.25");
    expect((await getOrderCosts(actor,"order-demo-008")).currencies[0].materials).toBe("50.00");
  });
  it("缺价格不记零成本，历史领用补归单不会再次扣料",async()=>{
    const before=await prisma.inventoryLot.findUniqueOrThrow({where:{id:IDS.lotD06Wh}});
    const moved=await transferInventory({...actor,lotId:before.id,qty:"20",toLocationId:IDS.factoryYunshan,idempotencyKey:"legacy-transfer"});
    const use=await consumeInventory({...actor,lotId:moved.toLotId!,qty:"10",idempotencyKey:"legacy-use"});
    await run({action:"assign_use",id:use.movement.id,orderId:"order-demo-005",basis:"核对本单实际耗用"});
    expect((await getOrderCosts(actor,"order-demo-005")).unknownValuationCount).toBe(1);
    expect((await prisma.inventoryLot.findUniqueOrThrow({where:{id:moved.toLotId!}})).qtyOnHand).toBe("10");
  });
  it("在途部分到货只转移原供给，本单占用随到货和领用递减",async()=>{
    await prisma.inventoryLot.create({data:{id:"arrival-lot",organizationId:actor.organizationId,materialId:IDS.materialD06,locationId:IDS.supplierQinghe,ownerKind:"company",colorName:"本色",qtyOnHand:"0",qtyAllocated:"60",qtyInbound:"100",qualityStatus:"qualified",availableFrom:"2026-09-01",inboundEta:"2026-09-25",demoNote:"在途测试"}});
    await prisma.inventoryAllocation.create({data:{id:"arrival-reserve",lotId:"arrival-lot",orderId:"order-demo-005",qty:"60",status:"held"}});
    const result=await run({action:"receive",orderId:"order-demo-005",supplierId:IDS.supplierQinghe,materialId:IDS.materialD06,locationId:IDS.factoryYunshan,colorName:"本色",qty:"20",reference:"ARR-001",occurredOn:"2026-09-18",basis:"部分实际到货",inboundLotId:"arrival-lot"});
    const receipt=await getMaterialReceipt(actor,result.id);
    const original=await prisma.inventoryLot.findUniqueOrThrow({where:{id:"arrival-lot"}});expect(original.qtyInbound).toBe("80");expect(original.qtyAllocated).toBe("40");
    const arrived=await prisma.inventoryLot.findUniqueOrThrow({where:{id:receipt.lotId}});expect(arrived.qtyOnHand).toBe("20");expect(arrived.qtyAllocated).toBe("20");
    await consumeInventory({...actor,lotId:receipt.lotId,orderId:"order-demo-005",qty:"10.5",idempotencyKey:"arrival-consume"});
    const left=await prisma.inventoryLot.findUniqueOrThrow({where:{id:receipt.lotId}});expect(left.qtyOnHand).toBe("9.5");expect(left.qtyAllocated).toBe("9.5");
  });
  it("有下游耗用时不能反向调拨，逐级冲销后收料归零且保留历史",async()=>{
    const r=await receive(),t=await transferInventory({...actor,lotId:r.lotId,qty:"60",toLocationId:IDS.factoryYunshan,idempotencyKey:"rev-t"});
    const u=await consumeInventory({...actor,lotId:t.toLotId!,qty:"10.5",orderId:"order-demo-005",idempotencyKey:"rev-u"});
    await expect(run({action:"reverse_transfer",id:t.movement.id,basis:"错误调拨"})).rejects.toThrow(/不足/);
    await run({action:"return_use",id:u.movement.id,qty:"10.5",reverse:true,basis:"领用登记错误"});
    await run({action:"reverse_transfer",id:t.movement.id,basis:"冲销原调拨"});
    await run({action:"reverse_receipt",id:r.id,expectedVersion:r.version,basis:"冲销重复收料"});
    expect((await prisma.inventoryLot.findUniqueOrThrow({where:{id:r.lotId}})).qtyOnHand).toBe("0");
    expect((await getMaterialReceipt(actor,r.id)).status).toBe("reversed");
    expect((await getOrderCosts(actor,"order-demo-005")).currencies).toEqual([]);
    expect((await getLotLedger(actor.organizationId,t.toLotId!,1)).recordedConsumedQty).toBe("10.5");
  });
  it("本单在途预留可以收成在库，其他订单的预留不能一起收",async()=>{
    await prisma.inventoryLot.create({data:{id:"planned-arrival",organizationId:actor.organizationId,materialId:IDS.materialMat001,locationId:IDS.supplierQinghe,ownerKind:"company",colorName:"海军蓝",qtyOnHand:"0",qtyAllocated:"80",qtyInbound:"80",qualityStatus:"qualified",availableFrom:"2026-09-01",inboundEta:"2026-09-28",demoNote:"在途预留"}});
    await prisma.inventoryAllocation.create({data:{id:"planned-arrival-own",lotId:"planned-arrival",orderId:"order-demo-002",qty:"80",status:"planned"}});
    await expect(run({action:"receive",orderId:"order-demo-005",supplierId:IDS.supplierQinghe,materialId:IDS.materialMat001,locationId:IDS.warehouse,colorName:"海军蓝",qty:"80",reference:"NOT-OWN",occurredOn:"2026-09-18",basis:"别的单来收",inboundLotId:"planned-arrival"})).rejects.toThrow(/可收范围/);
    const result=await run({action:"receive",orderId:"order-demo-002",supplierId:IDS.supplierQinghe,materialId:IDS.materialMat001,locationId:IDS.warehouse,colorName:"海军蓝",qty:"80",reference:"OWN-ARRIVAL",occurredOn:"2026-09-18",basis:"本单在途到货",inboundLotId:"planned-arrival"});
    const receipt=await getMaterialReceipt(actor,result.id);
    const original=await prisma.inventoryLot.findUniqueOrThrow({where:{id:"planned-arrival"}});
    expect(original.qtyInbound).toBe("0");
    expect(original.qtyAllocated).toBe("0");
    const arrived=await prisma.inventoryLot.findUniqueOrThrow({where:{id:receipt.lotId}});
    expect(arrived.qtyOnHand).toBe("80");
    expect(arrived.qtyAllocated).toBe("80");
    expect(arrived.locationId).toBe(IDS.warehouse);
    const moved=await prisma.inventoryAllocation.findFirstOrThrow({where:{lotId:receipt.lotId,orderId:"order-demo-002",status:"held"}});
    expect(moved.qty).toBe("80");
    expect((await prisma.inventoryAllocation.findUniqueOrThrow({where:{id:"planned-arrival-own"}})).status).toBe("moved");
  });
  it("计价修订保留旧版本，原币变更和超额退回被拦截",async()=>{
    const r=await receive();await run({action:"value_receipt",id:r.id,expectedVersion:2,currency:"CNY",unitPrice:"3",basis:"供应商修订报价"});
    const fresh=await getMaterialReceipt(actor,r.id);expect(fresh.valuations).toHaveLength(2);expect(fresh.netAmount).toBe("300.00");
    await expect(run({action:"value_receipt",id:r.id,expectedVersion:3,currency:"USD",unitPrice:"3",basis:"换币"})).rejects.toThrow(/币种/);
    await expect(run({action:"return_supplier",id:r.id,lotId:r.lotId,qty:"101",basis:"超量"})).rejects.toThrow(/超过/);
    expect((await prisma.inventoryLot.findUniqueOrThrow({where:{id:r.lotId}})).qtyOnHand).toBe("100");
  });
  it("收料权限不附带计价或财务披露，工厂不能读公司凭证",async()=>{
    const r=await receive();await setUserPermission({organizationId:actor.organizationId,managerId:actor.userId,targetUserId:IDS.userSales,action:"material_receive",enabled:true});
    const staff={...actor,userId:IDS.userSales,role:"salesperson"};expect((await getMaterialReceipt(staff,r.id)).unitPrice).toBeNull();
    await expect(runMaterialCommand(staff,{action:"value_receipt",id:r.id,expectedVersion:2,currency:"CNY",unitPrice:"3",basis:"越权",idempotencyKey:"no-price"})).rejects.toThrow(/无权/);
    await expect(getMaterialReceipt({...actor,userId:IDS.userFactory,role:"factory",factoryId:IDS.factoryYunshan},r.id)).rejects.toThrow(/无权/);
  });
  it("收料重试不重复增加库存，同凭证号不能另起一笔",async()=>{
    const payload={action:"receive",orderId:"order-demo-005",supplierId:IDS.supplierQinghe,materialId:IDS.materialD06,locationId:IDS.warehouse,colorName:"本色",qty:"10.125",reference:"UNIQUE-RECEIPT",occurredOn:"2026-09-18",basis:"收料",idempotencyKey:"same-receipt"};
    const a=await run(payload),b=await run(payload);expect(a.id).toBe(b.id);
    await expect(run({...payload,idempotencyKey:"another-key"})).rejects.toThrow(/凭证号/);
    expect(await prisma.materialReceipt.count()).toBe(1);
  });
  it("已核销的应付差异不能直接扣到核销额以下",async()=>{
    const r=await receive();const ap=await runTradeCommand(actor,{action:"create_bill",orderId:r.orderId,direction:"payable",partyId:r.supplierId,title:"收料应付",category:"materials",currency:"CNY",amount:"250",dueDate:"2026-09-25",basis:"收料",sourceKind:"receipt",sourceId:r.id,idempotencyKey:"paid-ap"});
    await runTradeCommand(actor,{action:"confirm_bill",id:ap.id,expectedVersion:1,idempotencyKey:"paid-confirm"});
    await prisma.tradeAllocation.create({data:{id:"paid-allocation",organizationId:actor.organizationId,billId:ap.id,cashId:(await prisma.tradeCash.create({data:{id:"paid-cash",organizationId:actor.organizationId,direction:"pay",partyKind:"party",partyId:r.supplierId,currency:"CNY",amountMinor:BigInt(25000),feeMinor:BigInt(0),bankAccount:"测试",bankReference:"TEST",occurredOn:"2026-09-18",basis:"测试付款",createdBy:actor.userId,createdAt:new Date().toISOString()}})).id,billAmountMinor:BigInt(25000),cashAmountMinor:BigInt(25000),exchangeRate:"1",rateDate:"2026-09-18",rateSource:"同币",createdBy:actor.userId,createdAt:new Date().toISOString()}});
    await run({action:"return_supplier",id:r.id,lotId:r.lotId,qty:"20",basis:"真实退料"});
    const fresh=await getMaterialReceipt(actor,r.id);await expect(run({action:"sync_payable",id:r.id,expectedVersion:fresh.version,billId:ap.id,expectedBillVersion:2,basis:"退供扣款"})).rejects.toThrow(/核销/);
    expect((await getTradeBill(actor,ap.id)).amount).toBe("250.00");
  });
});
