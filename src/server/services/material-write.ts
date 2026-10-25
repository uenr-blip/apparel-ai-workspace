import { nonnegativeMilli,reservedForOrder,consumeReservations } from "./material-reservations";
import { prisma } from "@/lib/db";
import { createId,sha256 } from "@/lib/hash";
import { checkDate,dateInZone,TradeError,formatMoney } from "@/lib/trade-money";
import { quantityMilli,quantityText,priceMicros,materialAmount } from "@/lib/material-quantity";
import { requireVersion,tradeOrder,tradeParty,billRow } from "./trade-db";
import type { TradeActor } from "./trade-contract";
import { MaterialCommandSchema,type MaterialCommand } from "./material-contract";
import { requireMaterial,receiptRow,netReceiptQty,receiptSnapshot,currentMaterialLot,changeMaterialLot,getMaterialUseRow,netUseQty,materialEvent,type MaterialDb,type EventRow } from "./material-db";
import { writeAudit } from "./intake";

export async function runMaterialCommand(actor:TradeActor,input:unknown){
  const parsed=MaterialCommandSchema.safeParse(input);if(!parsed.success)throw new TradeError(`请检查材料凭证：${parsed.error.issues[0].message}`);
  const command=parsed.data;await requireMaterial(prisma,actor,command.action);
  return prisma.$transaction(async db=>{
    await db.$executeRaw`INSERT INTO TradeBook(organizationId,revision) VALUES(${actor.organizationId},1) ON CONFLICT(organizationId) DO UPDATE SET revision=revision+1`;
    await requireMaterial(db,actor,command.action);
    const key=`material:${command.idempotencyKey}`,hash=sha256(JSON.stringify(command));
    const [previous]=await db.$queryRaw<Array<{requestHash:string;resultJson:string}>>`SELECT requestHash,resultJson FROM TradeOperation WHERE organizationId=${actor.organizationId} AND idempotencyKey=${key}`;
    if(previous){if(previous.requestHash!==hash)throw new TradeError("同一凭证标识的内容不一致",409);return {...JSON.parse(previous.resultJson) as {id:string;summary:string},reused:true};}
    const result=await executeMaterial(db,actor,command);
    await writeAudit({organizationId:actor.organizationId,actorUserId:actor.userId,action:`material.${command.action}`,entityType:"MaterialLedger",entityId:result.id,summary:result.summary,payloadJson:JSON.stringify(command)},db);
    await db.$executeRaw`INSERT INTO TradeOperation(id,organizationId,idempotencyKey,requestHash,resultJson,createdAt) VALUES(${createId()},${actor.organizationId},${key},${hash},${JSON.stringify(result)},${new Date().toISOString()})`;
    return {...result,reused:false};
  },{timeout:15000,maxWait:5000});
}
async function executeMaterial(db:MaterialDb,actor:TradeActor,c:MaterialCommand):Promise<{id:string;summary:string}>{
  const org=actor.organizationId,now=new Date().toISOString();
  if(c.action==="receive"){
    const order=await tradeOrder(db,actor,c.orderId);await tradeParty(db,org,"party",c.supplierId);
    const material=await db.material.findFirst({where:{organizationId:org,id:c.materialId}}),location=await db.party.findFirst({where:{organizationId:org,id:c.locationId,kind:{in:["warehouse","factory"]}}});
    if(!material||!location)throw new TradeError("材料或收料地点不存在");
    const inbound=await db.inventoryLot.findFirst({where:{organizationId:org,materialId:material.id,locationId:c.supplierId,colorName:c.colorName,ownerKind:"company",inboundEta:{not:null},qtyInbound:{not:"0"}}});
    if(inbound&&!c.inboundLotId)throw new TradeError("同一供货方的同料同色仍有在途记录，请先核实到货与在途的对应关系；本入口不重复增加这部分供给");
    const qty=quantityMilli(c.qty),occurred=checkDate(c.occurredOn),company=await db.organization.findUniqueOrThrow({where:{id:org}});
    if(occurred>dateInZone(new Date(),company.timezone))throw new TradeError("不能登记未来的实际收料");
    const duplicate=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM MaterialReceipt WHERE organizationId=${org} AND reference=${c.reference}`;
    if(duplicate.length)throw new TradeError("此收料凭证号已存在；同一送货单分行时请使用不同分行号");
    if(c.purchaseDraftId){
      const draft=await db.purchaseDraft.findFirst({where:{organizationId:org,id:c.purchaseDraftId,orderId:order.id,materialId:material.id,status:{in:["draft","issued"]}}});
      if(!draft)throw new TradeError("采购草稿不存在、已过期或材料/订单不匹配");
      const [net]=await db.$queryRaw<Array<{n:bigint}>>`SELECT COALESCE(SUM(r.qtyMilli-COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.receiptId=r.id AND e.organizationId=r.organizationId AND e.kind='return_supplier' AND e.status='active'),0)),0) n FROM MaterialReceipt r WHERE r.organizationId=${org} AND r.purchaseDraftId=${draft.id} AND r.status='active'`;
      if(net.n+qty>quantityMilli(draft.qty))throw new TradeError("累计净收料超过引用的采购草稿数量，请先核对实际采购依据");
    }
    const id=createId(),lotId=createId(),movementId=createId();
    let inboundSource=null,moveReserved=BigInt(0);
    if(c.inboundLotId){
      if(c.purchaseDraftId)throw new TradeError("\u5728\u9014\u5230\u8d27\u4e0e\u65b0\u91c7\u8d2d\u8349\u7a3f\u8bf7\u5206\u5f00\u6838\u5bf9");
      inboundSource=await db.inventoryLot.findFirst({where:{id:c.inboundLotId,organizationId:org,materialId:material.id,colorName:c.colorName,locationId:c.supplierId,ownerKind:"company",inboundEta:{not:null}}});
      if(!inboundSource||inboundSource.qtyOnHand!=="0")throw new TradeError("\u5728\u9014\u6279\u6b21\u4e0e\u4f9b\u8d27\u65b9\u6216\u6750\u6599\u989c\u8272\u4e0d\u5339\u914d");
      const incoming=nonnegativeMilli(inboundSource.qtyInbound),allocated=nonnegativeMilli(inboundSource.qtyAllocated),own=await reservedForOrder(db,inboundSource.id,order.id,["held","planned"]);
      if(allocated>incoming||own.qty>allocated||qty>incoming-allocated+own.qty)throw new TradeError("\u5230\u8d27\u8d85\u8fc7\u672c\u5355\u53ef\u6536\u8303\u56f4\uff0c\u5176\u4ed6\u8ba2\u5355\u7684\u5728\u9014\u9884\u7559\u9700\u6309\u5355\u62c6\u5206");
      moveReserved=qty<own.qty?qty:own.qty;
      await db.inventoryLot.update({where:{id:inboundSource.id},data:{qtyInbound:quantityText(incoming-qty),qtyAllocated:quantityText(allocated-moveReserved)}});
    }

    await db.inventoryLot.create({data:{id:lotId,organizationId:org,materialId:material.id,locationId:location.id,ownerKind:"company",colorName:c.colorName,qtyOnHand:quantityText(qty),qtyAllocated:quantityText(moveReserved),qtyInbound:"0",qualityStatus:"qualified",availableFrom:occurred,demoNote:"由实际收料凭证生成，未自动下达采购"}});
    if(inboundSource)await consumeReservations(db,inboundSource.id,order.id,moveReserved,lotId,"consumed",["held","planned"]);
    await db.inventoryMovement.create({data:{id:movementId,organizationId:org,materialId:material.id,kind:"receive",toLotId:lotId,toLocationId:location.id,qty:quantityText(qty),idempotencyKey:`receipt:${id}`,note:c.basis}});
    await db.$executeRaw`INSERT INTO MaterialReceipt(id,inboundLotId,organizationId,orderId,supplierId,materialId,lotId,movementId,purchaseDraftId,reference,receivedOn,qtyMilli,valuationVersion,version,status,basis,createdBy,createdAt) VALUES(${id},${c.inboundLotId||null},${org},${order.id},${c.supplierId},${material.id},${lotId},${movementId},${c.purchaseDraftId||null},${c.reference},${occurred},${qty},0,1,'active',${c.basis},${actor.userId},${now})`;
    await db.$executeRaw`INSERT INTO MaterialLotOrigin(lotId,organizationId,receiptId) VALUES(${lotId},${org},${id})`;
    await writeAudit({organizationId:org,actorUserId:actor.userId,action:"inventory.received",entityType:"InventoryMovement",entityId:movementId,summary:`${c.reference} \u5b9e\u9645\u6536\u6599 ${quantityText(qty)} ${material.unit}`,payloadJson:JSON.stringify({receiptId:id,basis:c.basis})},db);
    return {id,summary:`${order.orderNo} 实际收料 ${material.name} ${quantityText(qty)} ${material.unit}，待财务核对计价`};
  }
  if(c.action==="assign_use"||c.action==="value_use"){
    const use=await getMaterialUseRow(db,actor,c.id,true);
    if(c.action==="assign_use"){
      await tradeOrder(db,actor,c.orderId);
      if(use.orderId&&use.orderId!==c.orderId)throw new TradeError("已归单领用不能直接改属其他订单，请先冲销原领用再按实际重登");
      await db.$executeRaw`UPDATE MaterialUse SET orderId=${c.orderId},basis=${c.basis},version=version+1 WHERE movementId=${use.movementId} AND organizationId=${org}`;
      return {id:use.movementId,summary:"领用已补归订单，未再次扣库存"};
    }
    requireVersion(use.version,c.expectedVersion);
    if(use.receiptId)throw new TradeError("这笔领用有收料来源，请在收料凭证确认计价");
    if(use.unitPriceMicros!==null)throw new TradeError("历史领用计价已确认，不能覆盖原依据");
    const price=priceMicros(c.unitPrice);materialAmount(use.qtyMilli,price,c.currency);
    await db.$executeRaw`UPDATE MaterialUse SET currency=${c.currency},unitPriceMicros=${price},basis=${c.basis},version=version+1 WHERE organizationId=${org} AND movementId=${use.movementId}`;
    return {id:use.movementId,summary:"历史领用补充计价依据，未改历史库存数量"};
  }
  if(c.action==="release_reservation"){
    await tradeOrder(db,actor,c.orderId);const lot=await currentMaterialLot(db,org,c.id),qty=quantityMilli(c.qty),held=await reservedForOrder(db,lot.id,c.orderId),allocated=nonnegativeMilli(lot.qtyAllocated);
    if(qty>held.qty||qty>allocated)throw new TradeError("\u89e3\u9664\u6570\u91cf\u8d85\u8fc7\u672c\u5355\u5360\u7528");
    await consumeReservations(db,lot.id,c.orderId,qty,undefined,"released");
    await db.inventoryLot.update({where:{id:lot.id},data:{qtyAllocated:quantityText(allocated-qty)}});
    return {id:lot.id,summary:`\u89e3\u9664\u672c\u5355\u5360\u7528 ${quantityText(qty)}\uff0c\u5b9e\u7269\u5728\u624b\u4e0d\u53d8`};
  }
  if(c.action==="tag_cost"){
    const bill=await billRow(db,org,c.id);
    if(bill.direction!=="payable"||bill.status!=="confirmed"||bill.category!=="other"||bill.sourceKind!=="manual")throw new TradeError("其他费用只能引用已确认、手工登记的其他应付，材料和加工不能重复归集");
    await db.$executeRaw`INSERT INTO OrderCostTag(billId,organizationId,kind,active,basis,createdBy,createdAt) VALUES(${bill.id},${org},${c.kind},${c.active},${c.basis},${actor.userId},${now}) ON CONFLICT(billId) DO UPDATE SET kind=${c.kind},active=${c.active},basis=${c.basis},createdBy=${actor.userId},createdAt=${now}`;
    return {id:bill.id,summary:`${bill.orderNo} ${c.active?"归集":"撤销归集"}${c.kind==="freight"?"物流":"其他"}费用，金额取已确认应付`};
  }
  if(c.action==="return_use"){
    const use=await getMaterialUseRow(db,actor,c.id,true),qty=quantityMilli(c.qty),net=await netUseQty(db,use);
    if(qty>net||(c.reverse&&qty!==net))throw new TradeError("退回不能超过净领用，领用冲销须冲销全部剩余数量");
    if(use.receiptId&&(await receiptRow(db,org,use.receiptId)).status!=="active")throw new TradeError("来源收料已冲销");
    await changeMaterialLot(db,org,use.lotId,qty);
    const id=await materialEvent(db,actor,{receiptId:use.receiptId,useId:use.movementId,kind:c.reverse?"reverse_use":"return_unused",lotId:use.lotId,qty,basis:c.basis});
    return {id,summary:`${c.reverse?"冲销领用":"未耗用退回"} ${quantityText(qty)}，恢复本批次在手并减少原订单耗用`};
  }
  if(c.action==="reverse_event"){
    const [event]=await db.$queryRaw<EventRow[]>`SELECT * FROM MaterialEvent WHERE organizationId=${org} AND id=${c.id}`;
    if(!event||event.status!=="active"||!["return_supplier","return_unused","reverse_use"].includes(event.kind))throw new TradeError("凭证不存在、已经冲销或不支持再次反向冲销");
    if(event.receiptId&&(await receiptRow(db,org,event.receiptId)).status!=="active")throw new TradeError("来源收料已冲销");
    const incoming=event.kind==="return_supplier";
    await changeMaterialLot(db,org,event.lotId,incoming?event.qtyMilli:-event.qtyMilli);
    await db.$executeRaw`UPDATE MaterialEvent SET status='reversed' WHERE id=${event.id} AND organizationId=${org}`;
    const id=await materialEvent(db,actor,{receiptId:event.receiptId,useId:event.useId,kind:incoming?"reverse_supplier_return":"reverse_unused_return",lotId:event.lotId,qty:event.qtyMilli,basis:c.basis,reversesId:event.id});
    if(incoming)await db.$executeRaw`UPDATE MaterialReceipt SET version=version+1 WHERE organizationId=${org} AND id=${event.receiptId}`;
    return {id,summary:"已按相反数量冲销实物凭证，原记录保留；相关应付差异需重新核对"};
  }
  if(c.action==="reverse_transfer"){
    const transfer=await db.inventoryMovement.findFirst({where:{organizationId:org,id:c.id,kind:"transfer"}});
    if(!transfer?.fromLotId||!transfer.toLotId)throw new TradeError("调拨凭证不存在");
    const prior=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM MaterialEvent WHERE organizationId=${org} AND transferId=${transfer.id}`;
    if(prior.length)throw new TradeError("此调拨已经冲销");
    const qty=quantityMilli(transfer.qty);await changeMaterialLot(db,org,transfer.toLotId,-qty);await changeMaterialLot(db,org,transfer.fromLotId,qty);
    const id=await materialEvent(db,actor,{kind:"reverse_transfer",lotId:transfer.toLotId,toLotId:transfer.fromLotId,qty,basis:c.basis,transferId:transfer.id});
    return {id,summary:"调拨已反向冲销，公司在手总量不变，原凭证保留"};
  }
  const receipt=await receiptRow(db,org,c.id);
  if(receipt.status!=="active")throw new TradeError("收料凭证已冲销");
  if(c.action==="value_receipt"){
    requireVersion(receipt.version,c.expectedVersion);
    if(receipt.currency&&receipt.currency!==c.currency)throw new TradeError("已计价的收料不能直接更换币种");
    const price=priceMicros(c.unitPrice);materialAmount(receipt.qtyMilli,price,c.currency);
    const next=Number(receipt.valuationVersion)+1;
    await db.$executeRaw`INSERT INTO MaterialValuation(id,organizationId,receiptId,version,currency,unitPriceMicros,basis,createdBy,createdAt) VALUES(${createId()},${org},${receipt.id},${next},${c.currency},${price},${c.basis},${actor.userId},${now})`;
    await db.$executeRaw`UPDATE MaterialReceipt SET currency=${c.currency},unitPriceMicros=${price},valuationVersion=${next},version=version+1 WHERE organizationId=${org} AND id=${receipt.id}`;
    return {id:receipt.id,summary:`收料 ${receipt.reference} 保存计价版本${next}，当前成本按新依据核对；应付差异另行确认`};
  }
  if(c.action==="return_supplier"){
    const qty=quantityMilli(c.qty),[origin]=await db.$queryRaw<Array<{receiptId:string}>>`SELECT receiptId FROM MaterialLotOrigin WHERE organizationId=${org} AND lotId=${c.lotId}`;
    if(origin?.receiptId!==receipt.id)throw new TradeError("退供批次不属于本收料来源");
    if(qty>await netReceiptQty(db,receipt))throw new TradeError("累计退供超过原收料数量");
    await changeMaterialLot(db,org,c.lotId,-qty);
    const id=await materialEvent(db,actor,{receiptId:receipt.id,kind:"return_supplier",lotId:c.lotId,toLocationId:receipt.supplierId,qty,basis:c.basis});
    await db.$executeRaw`UPDATE MaterialReceipt SET version=version+1 WHERE organizationId=${org} AND id=${receipt.id}`;
    return {id,summary:`收料 ${receipt.reference} 退供 ${quantityText(qty)}，库存减少，应付差异待财务核对`};
  }
  if(c.action==="reverse_receipt"){
    requireVersion(receipt.version,c.expectedVersion);
    const bills=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM TradeBill WHERE organizationId=${org} AND sourceKind='receipt' AND sourceId=${receipt.id} AND status<>'void' LIMIT 1`;
    if(bills.length)throw new TradeError("请先处理并作废本收料关联应付，再冲销原收料");
    const [busy]=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM InventoryLot l JOIN MaterialLotOrigin o ON o.lotId=l.id AND o.organizationId=l.organizationId WHERE o.organizationId=${org} AND o.receiptId=${receipt.id} AND (l.qtyAllocated<>'0' OR (l.id<>${receipt.lotId} AND l.qtyOnHand<>'0'))`;
    const net=await netReceiptQty(db,receipt);
    if(busy.n>BigInt(0)||net!==receipt.qtyMilli)throw new TradeError("请先冲销退供或下游调拨/领用，并解除占用");
    await changeMaterialLot(db,org,receipt.lotId,-receipt.qtyMilli);
    if(receipt.inboundLotId){
      const incoming=await currentMaterialLot(db,org,receipt.inboundLotId);
      if(!incoming.inboundEta)throw new TradeError("\u539f\u5728\u9014\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5148\u6838\u5bf9");
      await db.inventoryLot.update({where:{id:incoming.id},data:{qtyInbound:quantityText(nonnegativeMilli(incoming.qtyInbound)+receipt.qtyMilli)}});
    }
    await materialEvent(db,actor,{receiptId:receipt.id,kind:"reverse_receipt",lotId:receipt.lotId,qty:receipt.qtyMilli,basis:c.basis});
    await db.$executeRaw`UPDATE MaterialReceipt SET status='reversed',version=version+1 WHERE organizationId=${org} AND id=${receipt.id}`;
    return {id:receipt.id,summary:`收料 ${receipt.reference} 已冲销，原数量凭证与计价历史保留`};
  }
  if(c.action==="sync_payable"){
    requireVersion(receipt.version,c.expectedVersion);const bill=await billRow(db,org,c.billId);requireVersion(bill.version,c.expectedBillVersion);
    if(bill.sourceKind!=="receipt"||bill.sourceId!==receipt.id||bill.status!=="confirmed")throw new TradeError("请选择本收料已经确认的来源应付；草稿变化后应作废重建");
    if(!receipt.currency||receipt.unitPriceMicros===null||receipt.currency!==bill.currency)throw new TradeError("计价缺失或币种不一致");
    const net=await netReceiptQty(db,receipt),desired=materialAmount(net,receipt.unitPriceMicros,receipt.currency),delta=desired-bill.totalMinor;
    if(desired<bill.allocatedMinor)throw new TradeError("调整后金额低于已核销额，请先撤回相关核销并核对剩余付款安排");
    if(delta!==BigInt(0))await db.$executeRaw`INSERT INTO TradeAdjustment(id,organizationId,billId,amountMinor,reason,createdBy,createdAt) VALUES(${createId()},${org},${bill.id},${delta},${`收料 ${receipt.reference} 版本${receipt.version}：${c.basis}`},${actor.userId},${now})`;
    await db.$executeRaw`UPDATE TradeBill SET sourceSnapshot=${receiptSnapshot(receipt,net)},version=version+1 WHERE organizationId=${org} AND id=${bill.id}`;
    await writeAudit({organizationId:org,actorUserId:actor.userId,action:"trade.material_reconciled",entityType:"TradeLedger",entityId:bill.id,summary:`${receipt.reference} 按实物与计价差异调整 ${receipt.currency} ${formatMoney(delta,receipt.currency)}`,payloadJson:JSON.stringify({receiptId:receipt.id,receiptVersion:Number(receipt.version),before:String(bill.totalMinor),after:String(desired),basis:c.basis})},db);
    return {id:receipt.id,summary:"实物与计价差异已记入独立应付扣补记录，未执行付款"};
  }
  throw new TradeError("不支持的材料动作");
}
