import type { Prisma } from "@prisma/client";
import { createId } from "@/lib/hash";
import { quantityMilli,quantityText } from "@/lib/material-quantity";
import { TradeError } from "@/lib/trade-money";
export const nonnegativeMilli=(raw:string)=>/^0+(\.0+)?$/.test(raw)?BigInt(0):quantityMilli(raw);
export async function reservedForOrder(db:Prisma.TransactionClient,lotId:string,orderId:string,statuses:Array<"held"|"planned">=["held"]){
  const rows=await db.inventoryAllocation.findMany({where:{lotId,orderId,status:{in:statuses}},take:501});
  if(rows.length>500)throw new TradeError("本批次占用记录过多，请先核对");
  return {rows:rows.sort((a,b)=>Number(a.status!=="held")-Number(b.status!=="held")),qty:rows.reduce((sum,r)=>sum+quantityMilli(r.qty),BigInt(0))};
}
export async function consumeReservations(db:Prisma.TransactionClient,lotId:string,orderId:string,qty:bigint,toLotId?:string,status="consumed",statuses:Array<"held"|"planned">=["held"]){
  const held=await reservedForOrder(db,lotId,orderId,statuses);let remaining=qty<held.qty?qty:held.qty;const moved=remaining;
  for(const row of held.rows){if(!remaining)break;const current=quantityMilli(row.qty),part=current<remaining?current:remaining;
    await db.inventoryAllocation.update({where:{id:row.id},data:part===current?{status:toLotId?"moved":status}:{qty:quantityText(current-part)}});
    if(toLotId)await db.inventoryAllocation.create({data:{id:createId(),lotId:toLotId,orderId,qty:quantityText(part),status:"held"}});
    remaining-=part;
  }
  return moved;
}
