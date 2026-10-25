import type { Prisma } from "@prisma/client";
import { createId,sha256 } from "@/lib/hash";
import { TradeError } from "@/lib/trade-money";
import { quantityMilli,quantityText,materialAmount } from "@/lib/material-quantity";
import { inventoryAvailability } from "@/server/domain/inventory";
import { d } from "@/server/domain/procurement";
import { writeAudit } from "./intake";
import { canUserAction } from "./user-permissions";
import { requireTrade,tradeOrder } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import type { MaterialCommand } from "./material-contract";
export type MaterialDb=Prisma.TransactionClient;
export type ReceiptRow={inboundLotId:string|null;id:string;organizationId:string;orderId:string;supplierId:string;materialId:string;lotId:string;movementId:string;purchaseDraftId:string|null;reference:string;receivedOn:string;qtyMilli:bigint;currency:string|null;unitPriceMicros:bigint|null;valuationVersion:number|bigint;version:number|bigint;status:string;basis:string;createdAt:string};
export type UseRow={movementId:string;organizationId:string;lotId:string;receiptId:string|null;orderId:string|null;qtyMilli:bigint;currency:string|null;unitPriceMicros:bigint|null;basis:string|null;version:number|bigint};
export type EventRow={id:string;organizationId:string;movementId:string;receiptId:string|null;useId:string|null;kind:string;lotId:string;qtyMilli:bigint;status:string;reversesId:string|null;transferId:string|null;basis:string;createdAt:string};
export async function requireMaterial(db:MaterialDb,actor:TradeActor,action:MaterialCommand["action"]|"read") {
  const user=await db.user.findFirst({where:{id:actor.userId,organizationId:actor.organizationId,role:actor.role,active:true}});
  if(!user||!["manager","salesperson"].includes(user.role))throw new TradeError("无权查阅或办理公司材料凭证",403);
  if(["value_receipt","value_use","sync_payable","tag_cost"].includes(action))return requireTrade(actor,"trade_confirm",db);
  if(action==="assign_use")return requireTrade(actor,"trade_prepare",db);
  if(action==="read"){
    if(await canUserAction(actor,"material_receive",db)||await canUserAction(actor,"material_correct",db))return;
    return requireTrade(actor,"trade_view",db);
  }
  if(!await canUserAction(actor,action==="receive"?"material_receive":"material_correct",db))throw new TradeError("无权办理此材料动作，请经理授权",403);
}
export async function receiptRow(db:MaterialDb,org:string,id:string) {
  const [row]=await db.$queryRaw<ReceiptRow[]>`SELECT * FROM MaterialReceipt WHERE organizationId=${org} AND id=${id}`;
  if(!row)throw new TradeError("收料凭证不存在或不属于当前组织",404);return row;
}
export async function netReceiptQty(db:MaterialDb,row:ReceiptRow) {
  if(row.status!=="active")return BigInt(0);
  const [sum]=await db.$queryRaw<Array<{n:bigint}>>`SELECT COALESCE(SUM(qtyMilli),0) n FROM MaterialEvent WHERE organizationId=${row.organizationId} AND receiptId=${row.id} AND kind='return_supplier' AND status='active'`;
  return row.qtyMilli-sum.n;
}
export async function materialSource(db:MaterialDb,actor:TradeActor,orderId:string,id:string) {
  const row=await receiptRow(db,actor.organizationId,id);
  if(row.status!=="active"||row.orderId!==orderId)throw new TradeError("收料凭证已冲销或不属于结算关联订单");
  if(!row.currency||row.unitPriceMicros===null)throw new TradeError("收料尚未确认计价依据");
  const net=await netReceiptQty(db,row);if(net<BigInt(0))throw new TradeError("净收料为零，不再形成新的应付");
  return {snapshot:receiptSnapshot(row,net),amount:materialAmount(net,row.unitPriceMicros,row.currency),partyId:row.supplierId,currency:row.currency};
}
export function receiptSnapshot(row:ReceiptRow,net:bigint){return sha256(JSON.stringify({id:row.id,version:Number(row.version),net:String(net),currency:row.currency,price:String(row.unitPriceMicros)}));}
export async function currentMaterialLot(db:MaterialDb,org:string,id:string){
  const lot=await db.inventoryLot.findFirst({where:{organizationId:org,id},include:{material:true,location:true}});
  if(!lot)throw new TradeError("材料批次不存在或不属于当前组织",404);return lot;
}
export async function changeMaterialLot(db:MaterialDb,org:string,id:string,delta:bigint){
  const lot=await currentMaterialLot(db,org,id);
  if(lot.ownerKind!=="company"||lot.inboundEta)throw new TradeError("只可更正公司自有且已到货的批次");
  const change=d(quantityText(delta<BigInt(0)?-delta:delta));
  if(delta<BigInt(0)){
    const available=inventoryAvailability(lot);
    if(!available.canMove||d(available.availableQty).lt(change))throw new TradeError("可办理库存不足，已占用或已耗用的材料不能直接扣走");
  }
  const qty=delta<BigInt(0)?d(lot.qtyOnHand).minus(change):d(lot.qtyOnHand).plus(change);
  const changed=await db.inventoryLot.updateMany({where:{id:lot.id,organizationId:org,qtyOnHand:lot.qtyOnHand,qtyAllocated:lot.qtyAllocated},data:{qtyOnHand:qty.toFixed()}});
  if(changed.count!==1)throw new TradeError("批次余额已变化，请刷新后重试",409);return lot;
}
export async function inheritMaterialOrigin(db:MaterialDb,org:string,fromLotId:string,toLotId:string){
  const [origin]=await db.$queryRaw<Array<{receiptId:string}>>`SELECT receiptId FROM MaterialLotOrigin WHERE organizationId=${org} AND lotId=${fromLotId}`;
  if(origin)await db.$executeRaw`INSERT INTO MaterialLotOrigin(lotId,organizationId,receiptId) VALUES(${toLotId},${org},${origin.receiptId})`;
}
export async function recordMaterialUse(db:MaterialDb,actor:TradeActor,movement:{id:string;fromLotId:string|null;qty:string},orderId?:string){
  if(!movement.fromLotId)throw new TradeError("领用缺少来源批次");
  if(orderId){const order=await tradeOrder(db,actor,orderId);if(actor.role==="factory"&&order.factoryId!==actor.factoryId)throw new TradeError("只能把耗用归到本厂负责的订单",403);}
  const [origin]=await db.$queryRaw<Array<{receiptId:string}>>`SELECT receiptId FROM MaterialLotOrigin WHERE organizationId=${actor.organizationId} AND lotId=${movement.fromLotId}`;
  const qty=quantityMilli(movement.qty);
  await db.$executeRaw`INSERT INTO MaterialUse(movementId,organizationId,lotId,receiptId,orderId,qtyMilli,version,createdBy,createdAt) VALUES(${movement.id},${actor.organizationId},${movement.fromLotId},${origin?.receiptId??null},${orderId||null},${qty},1,${actor.userId},${new Date().toISOString()})`;
}
export async function getMaterialUseRow(db:MaterialDb,actor:TradeActor,id:string,create=false){
  let [row]=await db.$queryRaw<UseRow[]>`SELECT * FROM MaterialUse WHERE organizationId=${actor.organizationId} AND movementId=${id}`;
  if(!row&&create){
    const move=await db.inventoryMovement.findFirst({where:{id,organizationId:actor.organizationId,kind:"consume"}});
    if(!move)throw new TradeError("领用凭证不存在");await currentMaterialLot(db,actor.organizationId,move.fromLotId??"");
    await recordMaterialUse(db,actor,move);[row]=await db.$queryRaw<UseRow[]>`SELECT * FROM MaterialUse WHERE organizationId=${actor.organizationId} AND movementId=${id}`;
  }
  if(!row)throw new TradeError("领用凭证尚未归集",404);return row;
}
export async function netUseQty(db:MaterialDb,row:UseRow){
  const [sum]=await db.$queryRaw<Array<{n:bigint}>>`SELECT COALESCE(SUM(qtyMilli),0) n FROM MaterialEvent WHERE organizationId=${row.organizationId} AND useId=${row.movementId} AND kind IN ('return_unused','reverse_use') AND status='active'`;
  return row.qtyMilli-sum.n;
}
export async function materialEvent(db:MaterialDb,actor:TradeActor,data:{receiptId?:string|null;useId?:string|null;kind:string;lotId:string;qty:bigint;basis:string;reversesId?:string;transferId?:string;toLotId?:string;toLocationId?:string}){
  const lot=await currentMaterialLot(db,actor.organizationId,data.lotId),id=createId(),movementId=createId();
  const incoming=["return_unused","reverse_use","reverse_supplier_return"].includes(data.kind);
  await db.inventoryMovement.create({data:{id:movementId,organizationId:actor.organizationId,materialId:lot.materialId,kind:data.kind,qty:quantityText(data.qty),fromLotId:incoming?null:lot.id,toLotId:incoming?lot.id:data.toLotId??null,fromLocationId:incoming?null:lot.locationId,toLocationId:incoming?lot.locationId:data.toLocationId??(data.toLotId?(await currentMaterialLot(db,actor.organizationId,data.toLotId)).locationId:null),idempotencyKey:`material-event:${id}`,note:data.basis}});
  await db.$executeRaw`INSERT INTO MaterialEvent(id,organizationId,movementId,receiptId,useId,kind,lotId,qtyMilli,reversesId,transferId,status,basis,createdBy,createdAt) VALUES(${id},${actor.organizationId},${movementId},${data.receiptId??null},${data.useId??null},${data.kind},${data.lotId},${data.qty},${data.reversesId??null},${data.transferId??null},'active',${data.basis},${actor.userId},${new Date().toISOString()})`;
  await writeAudit({organizationId:actor.organizationId,actorUserId:actor.userId,action:`inventory.${data.kind}`,entityType:"InventoryMovement",entityId:movementId,summary:`${data.kind} ${quantityText(data.qty)} ${lot.material.unit}：${data.basis}`,payloadJson:JSON.stringify({eventId:id,receiptId:data.receiptId??null,useId:data.useId??null,reversesId:data.reversesId??null})},db);
  return id;
}
