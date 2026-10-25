import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TradeError,formatMoney } from "@/lib/trade-money";
import { materialAmount } from "@/lib/material-quantity";
import { requireMaterial } from "./material-db";
import { canUserAction } from "./user-permissions";
import { requireTrade } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import type { TradeOption } from "./trade-lookup";
export async function materialLookup(actor:TradeActor,filter:{kind:string;q?:string;orderId?:string;receiptId?:string;materialId?:string;partyId?:string}):Promise<TradeOption[]>{
  const q=(filter.q??"").trim().slice(0,100),org=actor.organizationId;
  if(actor.role==="factory"){
    if(filter.kind!=="orders"||!await canUserAction(actor,"inventory_consume"))throw new TradeError("无权查阅公司材料凭证",403);
  }else await requireMaterial(prisma,actor,"read");
  if(filter.kind==="orders")return (await prisma.salesOrder.findMany({where:{organizationId:org,...(actor.role==="factory"?{factoryId:actor.factoryId??""}:{}),...(q?{orderNo:{contains:q}}:{})},orderBy:{updatedAt:"desc"},take:20})).map(row=>({id:row.id,label:row.orderNo}));
  if(filter.kind==="inbound")return(await prisma.inventoryLot.findMany({where:{organizationId:org,materialId:filter.materialId??"",locationId:filter.partyId??"",ownerKind:"company",inboundEta:{not:null},qtyInbound:{not:"0"}},take:20})).map(r=>({id:r.id,label:`${r.colorName} \u00b7 \u5728\u9014 ${r.qtyInbound} \u00b7 ${r.inboundNo??r.id.slice(-8)}`,colorName:r.colorName}));
  if(filter.kind==="materials")return (await prisma.material.findMany({where:{organizationId:org,...(q?{OR:[{name:{contains:q}},{code:{contains:q}}]}:{})},orderBy:{code:"asc"},take:20})).map(row=>({id:row.id,label:`${row.code} · ${row.name} · ${row.unit}`}));
  if(filter.kind==="suppliers"||filter.kind==="locations")return (await prisma.party.findMany({where:{organizationId:org,kind:{in:filter.kind==="locations"?["warehouse","factory"]:["supplier","factory"]},...(q?{name:{contains:q}}:{})},orderBy:{name:"asc"},take:20})).map(row=>({id:row.id,label:row.name}));
  if(filter.kind==="purchases")return (await prisma.purchaseDraft.findMany({where:{organizationId:org,orderId:filter.orderId??"",status:"draft",...(q?{material:{name:{contains:q}}}:{})},include:{material:true},take:20})).map(row=>({id:row.id,label:`${row.material.name} · ${row.qty} ${row.material.unit}`}));
  if(filter.kind==="receipt_lots"){
    const rows=await prisma.$queryRaw<Array<{id:string;qtyOnHand:string;name:string}>>(Prisma.sql`SELECT l.id,l.qtyOnHand,p.name FROM MaterialLotOrigin o JOIN InventoryLot l ON l.id=o.lotId AND l.organizationId=o.organizationId JOIN Party p ON p.id=l.locationId AND p.organizationId=l.organizationId WHERE o.organizationId=${org} AND o.receiptId=${filter.receiptId??""} ${q?Prisma.sql`AND instr(p.name,${q})>0`:Prisma.empty} ORDER BY l.id LIMIT 20`);
    return rows.map(row=>({id:row.id,label:`${row.name} · 在手${row.qtyOnHand} · ${row.id.slice(-6)}`}));
  }
  if(filter.kind==="transfers"){
    const rows=await prisma.$queryRaw<Array<{id:string;qty:string;name:string}>>(Prisma.sql`SELECT v.id,v.qty,m.name FROM InventoryMovement v JOIN Material m ON m.id=v.materialId AND m.organizationId=v.organizationId WHERE v.organizationId=${org} AND v.kind='transfer' AND NOT EXISTS(SELECT 1 FROM MaterialEvent e WHERE e.organizationId=v.organizationId AND e.transferId=v.id) ${q?Prisma.sql`AND instr(v.id||' '||m.name,${q})>0`:Prisma.empty} ORDER BY v.createdAt DESC,v.id LIMIT 20`);
    return rows.map(row=>({id:row.id,label:`${row.name} · 调拨${row.qty} · ${row.id.slice(-8)}`}));
  }
  throw new TradeError("不支持的材料查找类型");
}
export async function receiptOptions(actor:TradeActor,orderId:string,q=""):Promise<TradeOption[]>{
  await requireTrade(actor);
  const rows=await prisma.$queryRaw<Array<{id:string;reference:string;currency:string|null;unitPriceMicros:bigint|null;net:bigint;supplierId:string}>>(Prisma.sql`SELECT r.id,r.reference,r.currency,r.unitPriceMicros,r.supplierId,r.qtyMilli-COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.organizationId=r.organizationId AND e.receiptId=r.id AND e.kind='return_supplier' AND e.status='active'),0) net FROM MaterialReceipt r WHERE r.organizationId=${actor.organizationId} AND r.orderId=${orderId} AND r.status='active' ${q?Prisma.sql`AND instr(r.reference,${q.slice(0,100)})>0`:Prisma.empty} ORDER BY r.createdAt DESC LIMIT 20`);
  return rows.filter(r=>r.net>BigInt(0)).map(r=>{const amount=r.currency&&r.unitPriceMicros!==null?formatMoney(materialAmount(r.net,r.unitPriceMicros,r.currency),r.currency):"";return{id:r.id,label:`${r.reference} · ${r.currency??"待计价"} ${amount}`,currency:r.currency??"",amount,partyId:r.supplierId};});
}
