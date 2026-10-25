import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { TradeError,formatMoney } from "@/lib/trade-money";
import { materialAmount,priceText,quantityText } from "@/lib/material-quantity";
import { requireMaterial,receiptRow,netReceiptQty,receiptSnapshot } from "./material-db";
import { requireTrade,tradeOrder,billCte,type BillRow } from "./trade-db";
import { billView,tradeToday } from "./trade-read";
import type { TradeActor } from "./trade-contract";
import { resourcePage } from "./resource-scope";
async function financialAccess(actor:TradeActor){try{await requireTrade(actor);return true;}catch(error){if(error instanceof TradeError&&error.status===403)return false;throw error;}}
export async function getMaterialReceipt(actor:TradeActor,id:string){
  await requireMaterial(prisma,actor,"read");const row=await receiptRow(prisma,actor.organizationId,id),financial=await financialAccess(actor),net=await netReceiptQty(prisma,row),today=await tradeToday(actor);
  const [order,material,supplier,lots,events,valuations,payables]=await Promise.all([
    tradeOrder(prisma,actor,row.orderId),prisma.material.findFirstOrThrow({where:{id:row.materialId,organizationId:actor.organizationId}}),prisma.party.findFirstOrThrow({where:{id:row.supplierId,organizationId:actor.organizationId}}),
    prisma.$queryRaw<Array<{id:string;locationName:string;qtyOnHand:string;qtyAllocated:string}>>`SELECT l.id,p.name locationName,l.qtyOnHand,l.qtyAllocated FROM InventoryLot l JOIN MaterialLotOrigin o ON o.lotId=l.id AND o.organizationId=l.organizationId JOIN Party p ON p.id=l.locationId AND p.organizationId=l.organizationId WHERE o.organizationId=${actor.organizationId} AND o.receiptId=${id} ORDER BY l.id LIMIT 100`,
    prisma.$queryRaw<Array<{id:string;kind:string;qtyMilli:bigint;status:string;basis:string;createdAt:string}>>`SELECT id,kind,qtyMilli,status,basis,createdAt FROM MaterialEvent WHERE organizationId=${actor.organizationId} AND receiptId=${id} ORDER BY createdAt DESC,id LIMIT 20`,
    financial?prisma.$queryRaw<Array<{id:string;version:bigint;currency:string;unitPriceMicros:bigint;basis:string;createdAt:string}>>`SELECT id,version,currency,unitPriceMicros,basis,createdAt FROM MaterialValuation WHERE organizationId=${actor.organizationId} AND receiptId=${id} ORDER BY version DESC LIMIT 20`:Promise.resolve([]),
    financial?prisma.$queryRaw<BillRow[]>(Prisma.sql`${billCte(actor.organizationId)} SELECT * FROM bills WHERE sourceKind='receipt' AND sourceId=${id} AND status<>'void' ORDER BY createdAt DESC LIMIT 20`):Promise.resolve([]),
  ]);
  const amount=financial&&row.currency&&row.unitPriceMicros!==null?materialAmount(net,row.unitPriceMicros,row.currency):null;
  return {id:row.id,lotId:row.lotId,orderId:row.orderId,orderNo:order.orderNo,supplierId:row.supplierId,supplierName:supplier.name,materialName:material.name,materialCode:material.code,unit:material.unit,reference:row.reference,receivedOn:row.receivedOn,quantity:quantityText(row.qtyMilli),netQuantity:quantityText(net),status:row.status,version:Number(row.version),basis:row.basis,financial,
    currency:financial?row.currency:null,unitPrice:financial&&row.unitPriceMicros!==null?priceText(row.unitPriceMicros):null,netAmount:amount!==null&&row.currency?formatMoney(amount,row.currency):null,
    lots,events:events.map(e=>({...e,qtyMilli:undefined,quantity:quantityText(e.qtyMilli)})),valuations:valuations.map(v=>({id:v.id,version:Number(v.version),currency:v.currency,unitPrice:priceText(v.unitPriceMicros),basis:v.basis,createdAt:v.createdAt})),
    payables:payables.map(b=>({...billView(b,today),difference:amount!==null?formatMoney(amount-b.totalMinor,b.currency):null,sourceChanged:b.sourceSnapshot!==receiptSnapshot(row,net)})),
  };
}
export async function listMaterialReceipts(actor:TradeActor,filter:{q?:string;page?:string|number}={}){
  await requireMaterial(prisma,actor,"read");const page=resourcePage(filter.page),q=(filter.q??"").trim().slice(0,100);
  const scope=Prisma.sql`FROM MaterialReceipt r JOIN SalesOrder o ON o.id=r.orderId AND o.organizationId=r.organizationId JOIN Material m ON m.id=r.materialId AND m.organizationId=r.organizationId JOIN Party p ON p.id=r.supplierId AND p.organizationId=r.organizationId WHERE r.organizationId=${actor.organizationId} ${q?Prisma.sql`AND instr(lower(r.reference||' '||o.orderNo||' '||m.name||' '||m.code||' '||p.name),lower(${q}))>0`:Prisma.empty}`;
  const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),prisma.$queryRaw<Array<{id:string;reference:string;orderNo:string;supplierName:string;materialName:string;unit:string;qtyMilli:bigint;receivedOn:string;status:string;priced:bigint}>>(Prisma.sql`SELECT r.id,r.reference,o.orderNo,p.name supplierName,m.name materialName,m.unit,r.qtyMilli,r.receivedOn,r.status,CASE WHEN r.unitPriceMicros IS NULL THEN 0 ELSE 1 END priced ${scope} ORDER BY r.createdAt DESC,r.id LIMIT 20 OFFSET ${(page-1)*20}`)]);
  return {page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(r=>({...r,qtyMilli:undefined,quantity:quantityText(r.qtyMilli),priced:Number(r.priced)===1}))};
}
export async function listMaterialUses(actor:TradeActor,filter:{q?:string;page?:string|number}={}){
  await requireTrade(actor);const page=resourcePage(filter.page),q=(filter.q??"").trim().slice(0,100);
  const scope=Prisma.sql`FROM InventoryMovement m JOIN InventoryLot l ON l.id=m.fromLotId AND l.organizationId=m.organizationId JOIN Material a ON a.id=m.materialId AND a.organizationId=m.organizationId LEFT JOIN MaterialUse u ON u.movementId=m.id AND u.organizationId=m.organizationId LEFT JOIN SalesOrder o ON o.id=u.orderId AND o.organizationId=u.organizationId LEFT JOIN MaterialReceipt r ON r.id=u.receiptId AND r.organizationId=u.organizationId WHERE m.organizationId=${actor.organizationId} AND m.kind='consume' ${q?Prisma.sql`AND instr(lower(m.id||' '||COALESCE(o.orderNo,'')||' '||a.code||' '||a.name||' '||COALESCE(m.note,'')),lower(${q}))>0`:Prisma.empty}`;
  const [counts,rows]=await prisma.$transaction([prisma.$queryRaw<Array<{n:bigint}>>(Prisma.sql`SELECT COUNT(*) n ${scope}`),prisma.$queryRaw<Array<{id:string;orderId:string|null;orderNo:string|null;materialName:string;unit:string;qty:string;receiptId:string|null;version:bigint;priced:bigint}>>(Prisma.sql`SELECT m.id,u.orderId,o.orderNo,a.name materialName,a.unit,m.qty,u.receiptId,COALESCE(u.version,1) version,CASE WHEN COALESCE(r.unitPriceMicros,u.unitPriceMicros) IS NULL THEN 0 ELSE 1 END priced ${scope} ORDER BY m.createdAt DESC,m.id LIMIT 20 OFFSET ${(page-1)*20}`)]);
  return {page,total:Number(counts[0].n),pageCount:Math.max(1,Math.ceil(Number(counts[0].n)/20)),rows:rows.map(r=>({...r,version:Number(r.version),priced:Number(r.priced)===1}))};
}
export async function getOrderCosts(actor:TradeActor,orderId:string){
  await requireTrade(actor);const order=await tradeOrder(prisma,actor,orderId),org=actor.organizationId;
  const [groups,bills,unassigned]=await prisma.$transaction([
    prisma.$queryRaw<Array<{sourceId:string;currency:string|null;unitPriceMicros:bigint|null;qtyMilli:bigint;unit:string;materialName:string;receiptId:string|null}>>`WITH returned AS(SELECT useId,SUM(qtyMilli) n FROM MaterialEvent WHERE organizationId=${org} AND status='active' AND kind IN ('return_unused','reverse_use') GROUP BY useId)
      SELECT COALESCE(u.receiptId,u.movementId) sourceId,COALESCE(r.currency,u.currency) currency,COALESCE(r.unitPriceMicros,u.unitPriceMicros) unitPriceMicros,SUM(u.qtyMilli-COALESCE(e.n,0)) qtyMilli,a.unit,a.name materialName,u.receiptId
      FROM MaterialUse u JOIN InventoryLot l ON l.id=u.lotId AND l.organizationId=u.organizationId JOIN Material a ON a.id=l.materialId AND a.organizationId=l.organizationId LEFT JOIN MaterialReceipt r ON r.id=u.receiptId AND r.organizationId=u.organizationId LEFT JOIN returned e ON e.useId=u.movementId WHERE u.organizationId=${org} AND u.orderId=${orderId}
      GROUP BY COALESCE(u.receiptId,u.movementId),COALESCE(r.currency,u.currency),COALESCE(r.unitPriceMicros,u.unitPriceMicros),a.unit,a.name,u.receiptId HAVING SUM(u.qtyMilli-COALESCE(e.n,0))>0 LIMIT 5001`,
    prisma.$queryRaw<Array<BillRow&{costKind:string|null}>>(Prisma.sql`${billCte(org)} SELECT b.*,t.kind costKind FROM bills b LEFT JOIN OrderCostTag t ON t.billId=b.id AND t.organizationId=b.organizationId AND t.active=1 WHERE b.orderId=${orderId} AND b.direction='payable' AND b.status='confirmed' LIMIT 5001`),
    prisma.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM InventoryMovement m LEFT JOIN MaterialUse u ON u.movementId=m.id AND u.organizationId=m.organizationId WHERE m.organizationId=${org} AND m.kind='consume' AND u.orderId IS NULL AND (u.qtyMilli IS NULL OR u.qtyMilli>COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.organizationId=m.organizationId AND e.useId=m.id AND e.status='active' AND e.kind IN ('return_unused','reverse_use')),0))`,
  ]);
  if(groups.length>5000||bills.length>5000)throw new TradeError("单订单成本来源超过5000条，需分批核对，未返回截断合计");
  const totals=new Map<string,{materials:bigint;processing:bigint;other:bigint}>();
  const bucket=(currency:string)=>{if(!totals.has(currency))totals.set(currency,{materials:BigInt(0),processing:BigInt(0),other:BigInt(0)});return totals.get(currency)!;};
  let unknownValuationCount=0;
  const materialRows=groups.map(g=>{
    const amount=g.currency&&g.unitPriceMicros!==null?materialAmount(g.qtyMilli,g.unitPriceMicros,g.currency):null;
    if(amount===null)unknownValuationCount++;else bucket(g.currency!).materials+=amount;
    return {sourceId:g.sourceId,receiptId:g.receiptId,materialName:g.materialName,unit:g.unit,quantity:quantityText(g.qtyMilli),unitPrice:g.unitPriceMicros===null?null:priceText(g.unitPriceMicros),currency:g.currency,amount:amount===null?null:formatMoney(amount,g.currency!)};
  });
  const billRows=bills.map(b=>{
    const kind=b.category==="processing"&&!["receipt","purchase"].includes(b.sourceKind)?"processing":b.category==="other"&&b.sourceKind==="manual"&&b.costKind?"other":null;
    if(kind)bucket(b.currency)[kind]+=b.totalMinor;
    return {id:b.id,title:b.title,currency:b.currency,amount:formatMoney(b.totalMinor,b.currency),kind,category:b.category,sourceKind:b.sourceKind};
  });
  return {orderId:order.id,orderNo:order.orderNo,unknownValuationCount,unassignedUseCount:Number(unassigned[0].n),materialSourceCount:materialRows.length,billSourceCount:billRows.length,
    currencies:[...totals].map(([currency,value])=>({currency,materials:formatMoney(value.materials,currency),processing:formatMoney(value.processing,currency),other:formatMoney(value.other,currency),total:formatMoney(value.materials+value.processing+value.other,currency)})),materials:materialRows.slice(0,100),bills:billRows.slice(0,100)};
}
