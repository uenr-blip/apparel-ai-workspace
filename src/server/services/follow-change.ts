import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createId, sha256 } from "@/lib/hash";
import { readStoredMerchStyles } from "@/server/domain/merch-sheet";
import { summarizeProduction } from "@/server/domain/production";
import { ExecutionError } from "./execution";
import { lockOrganizationForWrite } from "./order-write";
import { hydrateLegacyFollowLinks, persistFollowRows } from "./follow-records";

type Actor = { organizationId: string; userId: string; role: string };
export type ChangeValues = { po: string; shipDate: string; colors: Array<{ colorName: string; quantity: number; sizes: Array<{ sizeCode: string; quantity: number }> }> };
async function actor(db: Prisma.TransactionClient, a: Actor, manager = false) {
  const u = await db.user.findFirst({ where: { id: a.userId, organizationId: a.organizationId, active: true, role: a.role } });
  if (!u || !["manager", "salesperson"].includes(u.role) || (manager && u.role !== "manager")) throw new ExecutionError(manager ? "涉及生产订单的客户改单须由主管确认" : "无权处理客户改单");
}
async function snapshot(db: Prisma.TransactionClient, a: Actor, sheetId: string) {
  const sheet = await db.orderMerchSheet.findFirst({ where: { id: sheetId, organizationId: a.organizationId }, include: { styles: { orderBy: { sort: "asc" }, include: { productionLine: { include: { order: { include: { lines: { include: { colors: { include: { sizes: true } }, followStyle: true } }, production: { include: { lines: true } }, purchaseDrafts: true, allocations: true, packingPlans: true } } } } } } } });
  if (!sheet) throw new ExecutionError("跟单不存在");
  const serialized = JSON.stringify(sheet, (_key, value) => Array.isArray(value) && value.every(v => v && typeof v === "object" && "id" in v) ? [...value].sort((a,b) => a.id.localeCompare(b.id)) : value);
  return { sheet, stamp: sha256(serialized) };
}
function currentValues(row: Awaited<ReturnType<typeof snapshot>>["sheet"]["styles"][number]): ChangeValues {
  const line = row.productionLine!, order = line.order;
  const colorLine = order.lines.find(l => l.id === line.id)!;
  return { po: order.externalCustomerPo ?? "", shipDate: order.requestedDeliveryDate?.slice(0,10) ?? "", colors: colorLine.colors.map(c => ({ colorName: c.colorName, quantity: c.quantity, sizes: c.sizes.map(s => ({ sizeCode: s.sizeCode, quantity: s.quantity })) })) };
}
function validate(row: Awaited<ReturnType<typeof snapshot>>["sheet"]["styles"][number], values: ChangeValues) {
  const order = row.productionLine?.order;
  if (!order || order.archivedAt || ["closed","cancelled","completed"].includes(order.status) || order.productionReadiness === "shipped") throw new ExecutionError("未关联或已结束的生产订单不能在此改单");
  if (values.po.length > 160 || values.shipDate && (!/^\d{4}-\d{2}-\d{2}$/.test(values.shipDate) || new Date(values.shipDate).toISOString().slice(0,10) !== values.shipDate)) throw new ExecutionError("请核对 PO 和完整交期");
  if (!values.colors.length || values.colors.length > 60 || new Set(values.colors.map(c => c.colorName.trim())).size !== values.colors.length) throw new ExecutionError("颜色不能为空或重复");
  for (const color of values.colors) {
    if (!color.colorName.trim() || !Number.isSafeInteger(color.quantity) || color.quantity < 0 || color.quantity > 10_000_000 || color.sizes.length > 40 || new Set(color.sizes.map(s => s.sizeCode.trim())).size !== color.sizes.length) throw new ExecutionError("请核对颜色与件数");
    if (color.sizes.some(s => !s.sizeCode.trim() || !Number.isSafeInteger(s.quantity) || s.quantity < 0) || color.sizes.length && color.sizes.reduce((n,s) => n+s.quantity,0) !== color.quantity) throw new ExecutionError("已填尺码时，尺码合计必须等于该颜色件数");
  }
  const previous = currentValues(row);
  if (JSON.stringify(values) === JSON.stringify(previous)) throw new ExecutionError("没有发生修改");
  const quantityChanged = JSON.stringify(values.colors) !== JSON.stringify(previous.colors);
  if (quantityChanged) {
    if (order.packingPlans.some(p => p.status === "occupied" || p.status === "shipped")) throw new ExecutionError("已有装箱占用或出运，请先在装箱流程处理数量影响；本入口仍可单独记录 PO 或交期修改");
    const relevant = order.production.filter(p => ["started", "transfer_in", "transfer_out"].includes(p.kind));
    if (relevant.some(p => p.lines.reduce((n,l) => n+l.quantity,0) !== p.quantity)) throw new ExecutionError("历史产量缺少色尺明细，请先核对实数，不能直接修改数量");
    const oldLine = order.lines.find(l => l.id === row.productionLine!.id)!;
    for (const old of oldLine.colors) {
      if (order.lines.some(l => l.id !== oldLine.id && l.colors.some(c => c.colorName === old.colorName)) && relevant.length) throw new ExecutionError("多款同色产量尚未区分归属，先核对实数，不能直接改单");
      const next = values.colors.find(c => c.colorName === old.colorName);
      if (!next) throw new ExecutionError("原颜色请保留，取消时填 0，不能删除历史颜色");
      const started = summarizeProduction(relevant.map(p => ({ kind:p.kind, quantity:p.lines.filter(l => l.colorName === old.colorName).reduce((n,l)=>n+l.quantity,0) }))).started;
      if (next.quantity < started) throw new ExecutionError(`${old.colorName} 新数量不能少于当前已开工 ${started} 件；超出客户需求的在制须另记处置`);
      for (const size of old.sizes) {
        const actual = summarizeProduction(relevant.map(p => ({ kind:p.kind, quantity:p.lines.filter(l => l.colorName===old.colorName && l.sizeCode===size.sizeCode).reduce((n,l)=>n+l.quantity,0) }))).started;
        if ((next.sizes.find(s => s.sizeCode === size.sizeCode)?.quantity ?? 0) < actual) throw new ExecutionError(`${old.colorName}/${size.sizeCode} 不能少于已开工 ${actual} 件`);
      }
    }
  }
  return { orderId: order.id, orderNo: order.orderNo, quantityChanged, deliveryChanged: values.shipDate !== previous.shipDate, poChanged: values.po !== previous.po, purchases: order.purchaseDrafts.length, allocations: order.allocations.length, productionRecords: order.production.length, affectedStyles: order.lines.map(l => l.followStyle?.styleCode || l.id), requiresManager: true };
}
async function audit(db: Prisma.TransactionClient, a: Actor, id: string, action: string, before: unknown, after: unknown, basis: string) {
  await db.auditEvent.create({ data: { id:createId(), organizationId:a.organizationId, actorType:"user", actorUserId:a.userId, entityType:"FollowChange", entityId:id, action:`follow.change_${action}`, summary:basis, payloadJson:JSON.stringify({before,after,basis}) } });
}
export async function getFollowChangeBoard(a: Actor, sheetId: string) {
  await actor(prisma,a);
  const snap = await snapshot(prisma,a,sheetId);
  const records = await prisma.followChange.findMany({ where:{ organizationId:a.organizationId, sheetId }, orderBy:{createdAt:"desc"} });
  const people = await prisma.user.findMany({ where:{ organizationId:a.organizationId }, select:{ id:true,name:true } });
  return { sheetId, kind:snap.sheet.kind, title:snap.sheet.title, stamp:snap.stamp, rows:snap.sheet.styles.filter(r=>r.productionLine).map(r=>({id:r.id,label:r.styleCode || r.styleName,orderNo:r.productionLine!.order.orderNo, values:currentValues(r)})), records:records.map(r=>({id:r.id,status:r.status,reason:r.reason,sourceReference:r.sourceReference,createdAt:r.createdAt.toISOString(),requestedBy:people.find(p=>p.id===r.requestedBy)?.name||"已留档",before:JSON.parse(r.beforeJson).values as ChangeValues,after:JSON.parse(r.afterJson).values as ChangeValues,impact:JSON.parse(r.impactJson),decisionNote:r.decisionNote})) };
}
export async function requestFollowChange(a:Actor,input:{sheetId:string;rowId:string;stamp:string;reason:string;sourceReference:string;values:ChangeValues}) {
  if (!input.reason.trim() || !input.sourceReference.trim()) throw new ExecutionError("请填写客户改单原因与原始依据");
  return prisma.$transaction(async db=>{
    await lockOrganizationForWrite(db,a.organizationId);await actor(db,a);
    const {sheet,stamp}=await snapshot(db,a,input.sheetId);
    if(stamp!==input.stamp) throw new ExecutionError("依据已变化，请刷新后核对");
    const row=sheet.styles.find(r=>r.id===input.rowId);if(!row?.productionLine)throw new ExecutionError("本款尚未关联生产单，请先核对跟单关联");
    const impact=validate(row,input.values);
    const pending=await db.followChange.findFirst({where:{organizationId:a.organizationId,sheetId:sheet.id,status:{in:["requested","reviewed"]}}});
    if(pending){const after=JSON.parse(pending.afterJson);if(after.rowId===input.rowId && JSON.stringify(after.values)===JSON.stringify(input.values) && pending.reason===input.reason.trim() && pending.sourceReference===input.sourceReference.trim())return {id:pending.id,reused:true};throw new ExecutionError("本跟单已有待处理改单，请先处理或退回");}
    const record=await db.followChange.create({data:{id:createId(),organizationId:a.organizationId,sheetId:sheet.id,status:"requested",reason:input.reason.trim(),sourceReference:input.sourceReference.trim(),beforeJson:JSON.stringify({rowId:row.id,values:currentValues(row),snapshot:sheet}),afterJson:JSON.stringify({rowId:row.id,values:input.values}),impactJson:JSON.stringify(impact),baseStamp:stamp,requestedBy:a.userId}});
    await audit(db,a,record.id,"requested",JSON.parse(record.beforeJson),JSON.parse(record.afterJson),input.sourceReference);
    return{id:record.id,reused:false};
  });
}
export async function decideFollowChange(a:Actor,input:{id:string;action:"review"|"approve"|"reject";note:string}) {
  if(!input.note.trim())throw new ExecutionError("请填写影响核对或处理意见");
  return prisma.$transaction(async db=>{
    await lockOrganizationForWrite(db,a.organizationId);await actor(db,a,input.action==="approve");
    const record=await db.followChange.findFirst({where:{id:input.id,organizationId:a.organizationId}});if(!record)throw new ExecutionError("改单记录不存在");
    if(record.status==="executed" && input.action==="approve")return{id:record.id,orderId:JSON.parse(record.impactJson).orderId,reused:true};
    if(["executed","rejected"].includes(record.status))throw new ExecutionError("已处理的改单不能覆盖历史");
    if(input.action==="reject"){
      await db.followChange.update({where:{id:record.id},data:{status:"rejected",decidedBy:a.userId,decisionNote:input.note.trim()}});await audit(db,a,record.id,"rejected",{status:record.status},{status:"rejected",note:input.note},record.sourceReference);return{id:record.id,reused:false};
    }
    const{sheet,stamp}=await snapshot(db,a,record.sheetId);if(stamp!==record.baseStamp)throw new ExecutionError("跟单、生产或采购依据已变化，请退回后按最新资料重新登记");
    const after=JSON.parse(record.afterJson) as {rowId:string;values:ChangeValues};const row=sheet.styles.find(r=>r.id===after.rowId);if(!row?.productionLine)throw new ExecutionError("原款关联已变化");
    const impact=validate(row,after.values);
    if(input.action==="review"){
      if(record.status!=="requested")throw new ExecutionError("影响已核对，修改需退回重做");
      await db.followChange.update({where:{id:record.id},data:{status:"reviewed",impactJson:JSON.stringify({...impact,reviewedBy:a.userId,reviewedAt:new Date().toISOString(),reviewNote:input.note.trim()})}});await audit(db,a,record.id,"reviewed",{status:"requested"},{status:"reviewed",reviewedBy:a.userId,note:input.note},record.sourceReference);return{id:record.id,reused:false};
    }
    if(record.status!=="reviewed")throw new ExecutionError("负责人尚未核对采购、料况、交期及生产影响");
    const order=row.productionLine.order;const line=order.lines.find(l=>l.id===row.productionLine!.id)!;
    if(impact.quantityChanged){
      for(const c of after.values.colors){
        const old=line.colors.find(o=>o.colorName===c.colorName);
        const saved=old?await db.orderColorQty.update({where:{id:old.id},data:{quantity:c.quantity}}):await db.orderColorQty.create({data:{id:createId(),lineId:line.id,colorName:c.colorName.trim(),quantity:c.quantity}});
        for(const size of c.sizes){const existing=old?.sizes.find(s=>s.sizeCode===size.sizeCode);if(existing)await db.orderSizeQty.update({where:{id:existing.id},data:{quantity:size.quantity}});else await db.orderSizeQty.create({data:{id:createId(),colorId:saved.id,sizeCode:size.sizeCode,quantity:size.quantity}});}
        await db.orderSizeQty.deleteMany({where:{colorId:saved.id,sizeCode:{notIn:c.sizes.map(s=>s.sizeCode)}}});
        if(c.quantity>0 && (!old || JSON.stringify({quantity:old.quantity,sizes:old.sizes.map(s=>({sizeCode:s.sizeCode,quantity:s.quantity}))})!==JSON.stringify({quantity:c.quantity,sizes:c.sizes}))){
          const last=await db.confirmationRecord.findFirst({where:{orderId:order.id,colorName:c.colorName},orderBy:{round:"desc"}});
          await db.confirmationRecord.create({data:{id:createId(),orderId:order.id,colorName:c.colorName,round:(last?.round??0)+1,status:"pending",evidence:`客户改单 ${record.id}，请重新核对分色与数量`}});
        }
      }
      await db.orderLine.update({where:{id:line.id},data:{totalQuantity:after.values.colors.reduce((n,c)=>n+c.quantity,0)}});
    }
    const related=await db.orderMerchSheet.findMany({where:{organizationId:a.organizationId,styles:{some:{productionLine:{orderId:order.id}}}},include:{styles:{orderBy:{sort:"asc"}}}});
    for(const linked of related){
      const styles=readStoredMerchStyles(linked,{styleCode:"",styleName:""});
      for(const style of styles){
        const link=linked.styles.find(r=>r.id===style.rowId);if(!link?.productionLineId || !order.lines.some(l=>l.id===link.productionLineId))continue;
        if(linked.kind!=="bulk")throw new ExecutionError("此入口先处理大货改单，销售样请另行核对");
        style.bulk.po=after.values.po.trim();style.bulk.shipDate=after.values.shipDate;
        if(link.id===row.id && impact.quantityChanged){
          style.bulk.colors=after.values.colors.map(c=>({...style.bulk.colors.find(v=>v.guestColor===c.colorName),guestColor:c.colorName,factoryColorName:style.bulk.colors.find(v=>v.guestColor===c.colorName)?.factoryColorName??"",metalBadge:style.bulk.colors.find(v=>v.guestColor===c.colorName)?.metalBadge??"",qtyText:c.quantity===0?"不下":String(c.quantity)}));
        }
      }
      await persistFollowRows(db,linked.id,styles);await db.orderMerchSheet.update({where:{id:linked.id},data:{updatedAt:new Date()}});
    }
    await db.salesOrder.update({where:{id:order.id},data:{externalCustomerPo:after.values.po.trim()||null,requestedDeliveryDate:after.values.shipDate?after.values.shipDate:null,requestedDeliveryText:after.values.shipDate, ...(impact.quantityChanged?{productionReadiness:"blocked_follow_change"}:{})}});
    await db.actionProposal.updateMany({where:{organizationId:a.organizationId,status:"preview",payloadJson:{contains:order.id}},data:{status:"expired"}});
    await db.taskItem.create({data:{id:createId(),organizationId:a.organizationId,relatedOrderId:order.id,title:"客户改单后核对采购、用料与工厂安排",kind:"follow_change_review",status:"open",blocking:false,assigneeRole:"salesperson",note:`改单 ${record.id}；${JSON.parse(record.impactJson).reviewNote}；原采购、收付、出运不改写。${impact.quantityChanged?"色尺与分色核对后由主管重新放行。":""}`}});
    await db.followChange.update({where:{id:record.id},data:{status:"executed",decidedBy:a.userId,decisionNote:input.note.trim()}});
    await audit(db,a,record.id,"executed",JSON.parse(record.beforeJson),{...after,orderId:order.id,decisionNote:input.note},record.sourceReference);
    return{id:record.id,orderId:order.id,reused:false};
  },{timeout:30000});
}
// Explicitly requested link repair uses the same audited verification as opening remaining rows.
export async function verifyFollowChangeLinks(a:Actor,sheetId:string){return prisma.$transaction(async db=>{await lockOrganizationForWrite(db,a.organizationId);await actor(db,a);const {sheet}=await snapshot(db,a,sheetId);await hydrateLegacyFollowLinks(db,sheet,a.userId);return{sheetId};});}
