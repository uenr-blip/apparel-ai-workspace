import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { labels } from "@/lib/labels";
import { TradeError } from "@/lib/trade-money";
import { quantityText } from "@/lib/material-quantity";
import { requireMaterial } from "./material-db";
import { authorizeBusinessRead } from "./business-search";
import type { TradeActor } from "./trade-contract";
export type PartnerKind="customer"|"factory"|"supplier";
export const ORDER_GROUPS={active:"正在执行",draft:"草稿 / 待明确",history:"已出完 / 已结束",all:"全部记录"} as const;
type Group=keyof typeof ORDER_GROUPS;
type OrderRow={id:string;orderNo:string;status:string;productionReadiness:string;requestedDeliveryDate:string|null;requestedDeliveryText:string|null;customerName:string;factoryName:string|null;createdAt:Date;ordered:bigint;started:bigint;good:bigint;shipped:bigint;rework:bigint;scrapped:bigint;bucket:Exclude<Group,"all">};
export async function getPartnerDossier(actor:TradeActor,kind:PartnerKind,id:string,options:{group?:string;page?:number;brandId?:string;receiptPage?:number;samplePage?:number}={}) {
 await authorizeBusinessRead(actor);
 if(actor.role==="factory"&&(kind!=="factory"||id!==actor.factoryId))throw new TradeError("无权查阅这个业务伙伴",403);
 if(kind==="supplier") await requireMaterial(prisma,actor,"read");
 const org=actor.organizationId;
 const partner=kind==="customer"?await prisma.customer.findFirst({where:{id,organizationId:org},select:{id:true,code:true,name:true}}):await prisma.party.findFirst({where:{id,kind,organizationId:org},select:{id:true,code:true,name:true}});
 if(!partner)throw new TradeError("没有找到这个业务伙伴",404);
 const scope=kind==="customer"?Prisma.sql`o.customerId=${id}`:kind==="factory"?Prisma.sql`o.factoryId=${id}`:Prisma.sql`EXISTS(SELECT 1 FROM MaterialReceipt r WHERE r.organizationId=${org} AND r.orderId=o.id AND r.supplierId=${id})`;
 const brands=kind==="customer"?await prisma.styleOption.findMany({where:{organizationId:org,kind:"brand",brandStyles:{some:{organizationId:org,orderLines:{some:{order:{organizationId:org,customerId:id}}}}}},select:{id:true,name:true},orderBy:{name:"asc"}}):[];
 const brandId=options.brandId?.slice(0,100)||"";
 const brandScope=kind==="customer"&&brandId?Prisma.sql`AND EXISTS(SELECT 1 FROM OrderLine l JOIN Style s ON s.id=l.styleId AND s.organizationId=${org} WHERE l.orderId=o.id AND s.brandOptionId=${brandId})`:Prisma.empty;
 const cte=Prisma.sql`WITH data AS (SELECT o.id,o.orderNo,o.status,o.productionReadiness,o.requestedDeliveryDate,o.requestedDeliveryText,o.createdAt,c.name customerName,f.name factoryName,
 COALESCE((SELECT SUM(l.totalQuantity) FROM OrderLine l WHERE l.orderId=o.id),0) ordered,
 COALESCE((SELECT SUM(p.quantity) FROM ProductionQty p WHERE p.orderId=o.id AND p.kind='started'),0) started,
 COALESCE((SELECT SUM(p.quantity) FROM ProductionQty p WHERE p.orderId=o.id AND p.kind='good'),0) good,
 COALESCE((SELECT SUM(p.quantity) FROM ProductionQty p WHERE p.orderId=o.id AND p.kind='shipped'),0) shipped,
 COALESCE((SELECT SUM(p.quantity) FROM ProductionQty p WHERE p.orderId=o.id AND p.kind='rework'),0) rework,
 COALESCE((SELECT SUM(p.quantity) FROM ProductionQty p WHERE p.orderId=o.id AND p.kind='scrapped'),0) scrapped
 FROM SalesOrder o JOIN Customer c ON c.id=o.customerId AND c.organizationId=o.organizationId LEFT JOIN Party f ON f.id=o.factoryId AND f.organizationId=o.organizationId WHERE o.organizationId=${org} AND ${scope} ${brandScope}),
 classified AS (SELECT *,CASE WHEN status IN ('cancelled','closed','completed') OR (ordered>0 AND shipped>=ordered) THEN 'history' WHEN status='draft' THEN 'draft' ELSE 'active' END bucket FROM data)`;
 const counts=await prisma.$queryRaw<Array<{bucket:Exclude<Group,"all">;n:bigint}>>(Prisma.sql`${cte} SELECT bucket,COUNT(*) n FROM classified GROUP BY bucket`);
 const group=Object.hasOwn(ORDER_GROUPS,options.group||"")?options.group as Group:"active";
 const totals={active:0,draft:0,history:0,all:0};for(const row of counts){totals[row.bucket]=Number(row.n);totals.all+=Number(row.n);}
 const pageCount=Math.max(1,Math.ceil(totals[group]/20)),page=Math.min(pageCount,Math.max(1,Math.floor(Number(options.page)||1)));
 const rows=await prisma.$queryRaw<OrderRow[]>(Prisma.sql`${cte} SELECT * FROM classified WHERE ${group==="all"?Prisma.sql`1=1`:Prisma.sql`bucket=${group}`} ORDER BY createdAt DESC,id LIMIT 20 OFFSET ${(page-1)*20}`);
 const orderIds=rows.map(r=>r.id);
 const [lines,tasks]=await Promise.all([
  prisma.orderLine.findMany({where:{orderId:{in:orderIds},order:{organizationId:org}},select:{orderId:true,style:{select:{code:true,name:true,brandOption:{select:{name:true}}}}}}),
  prisma.taskItem.findMany({where:{organizationId:org,relatedOrderId:{in:orderIds},blocking:true,status:"open"},select:{relatedOrderId:true,title:true}}),
 ]);
 const orders=rows.map(r=>({id:r.id,orderNo:r.orderNo,statusLabel:labels.orderStatus(r.status),group:r.bucket,customerName:r.customerName,factoryName:r.factoryName||"尚未分配",delivery:r.requestedDeliveryDate||r.requestedDeliveryText||"待确认",ordered:Number(r.ordered),started:Number(r.started),good:Number(r.good),shipped:Number(r.shipped),rework:Number(r.rework),scrapped:Number(r.scrapped),readiness:labels.readiness(r.productionReadiness),styles:lines.filter(l=>l.orderId===r.id).map(l=>`${l.style.code} ${l.style.name}${l.style.brandOption?` · ${l.style.brandOption.name}`:""}`),blockers:tasks.filter(t=>t.relatedOrderId===r.id).map(t=>t.title),href:`/orders/${r.id}`}));
 const receiptPage=Math.max(1,Math.floor(Number(options.receiptPage)||1));
 const receiptCount=kind==="supplier"?(await prisma.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) n FROM MaterialReceipt WHERE organizationId=${org} AND supplierId=${id}`)[0].n:BigInt(0);
 const receiptPages=Math.max(1,Math.ceil(Number(receiptCount)/20)),rp=Math.min(receiptPage,receiptPages);
 const receipts=kind==="supplier"?await prisma.$queryRaw<Array<{id:string;reference:string;orderId:string;orderNo:string;materialCode:string;materialName:string;unit:string;qtyMilli:bigint;returned:bigint;status:string;receivedOn:string;purchaseStatus:string|null}>>`SELECT r.id,r.reference,r.orderId,o.orderNo,m.code materialCode,m.name materialName,m.unit,r.qtyMilli,r.status,r.receivedOn,p.status purchaseStatus,
 COALESCE((SELECT SUM(e.qtyMilli) FROM MaterialEvent e WHERE e.organizationId=r.organizationId AND e.receiptId=r.id AND e.kind='return_supplier' AND e.status='active'),0) returned
 FROM MaterialReceipt r JOIN SalesOrder o ON o.id=r.orderId AND o.organizationId=r.organizationId JOIN Material m ON m.id=r.materialId AND m.organizationId=r.organizationId LEFT JOIN PurchaseDraft p ON p.id=r.purchaseDraftId AND p.organizationId=r.organizationId WHERE r.organizationId=${org} AND r.supplierId=${id} ORDER BY r.receivedOn DESC,r.id LIMIT 20 OFFSET ${(rp-1)*20}`:[];
 const sampleWhere={factoryId:id,project:{organizationId:org},...(actor.role==="factory"?{issuedAt:{not:null}}:{})};
 const sampleCount=kind==="factory"?await prisma.patternSample.count({where:sampleWhere}):0,samplePages=Math.max(1,Math.ceil(sampleCount/20)),sp=Math.min(samplePages,Math.max(1,Math.floor(Number(options.samplePage)||1)));
 const samples=kind==="factory"?await prisma.patternSample.findMany({where:sampleWhere,select:{id:true,projectId:true,round:true,quantity:true,dueDate:true,issuedAt:true,receivedAt:true,feedbackJson:actor.role!=="factory",project:{select:{code:true,name:true}},revision:{select:{number:true}}},orderBy:{createdAt:"desc"},skip:(sp-1)*20,take:20}):[];
 const projects=kind==="customer"?await prisma.developmentProject.findMany({where:{organizationId:org,customerId:id},select:{id:true,code:true,name:true,status:true},orderBy:{updatedAt:"desc"},take:20}):[];
 return {partner,kind,brands,brandId,group,totals,page,pageCount,orders,projects,
  receipts:receipts.map(r=>({id:r.id,reference:r.reference,orderId:r.orderId,orderNo:r.orderNo,materialCode:r.materialCode,materialName:r.materialName,unit:r.unit,quantity:quantityText(r.qtyMilli),returned:quantityText(r.returned),netQuantity:r.status==="active"?quantityText(r.qtyMilli-r.returned):"0",status:r.status,receivedOn:r.receivedOn,purchaseStatus:r.purchaseStatus,href:`/resources/material-ledger/${r.id}`})),receiptPage:rp,receiptPages,receiptCount:Number(receiptCount),
  samples:samples.map(s=>({id:s.id,title:`${s.project.code} ${s.project.name}`,version:s.revision.number,round:s.round,quantity:s.quantity,dueDate:s.dueDate,stage:s.receivedAt?"工厂已确认收到":s.issuedAt?"已发厂，待回执":"负责人尚未发厂",returnedOn:actor.role!=="factory"?(JSON.parse(s.feedbackJson||"{}").returnedOn||""):"",href:actor.role==="factory"?`/projects/${s.projectId}/samples/${s.id}`:`/projects/${s.projectId}`})),samplePage:sp,samplePages,sampleCount,
  notes:["按真实订单、产量和来源凭证汇总；未登记的进度无法推断。","‘已出完’按已出运数量达到订单数量判断，不代表财务结清。",...(kind==="customer"?["品牌来自该客户订单里的款式记录，不是正式的客户品牌归属档案。","‘预约中’尚未定义，草稿不等于已承诺订单或已预约产能。"]:kind==="supplier"?["仅按明确收料来源关联供应商和订单；历史报价不等于已下采购。","采购草稿目前未直接记录供应商，不能据同一种材料推断哪些未到货采购属于本供应商。"]:[])]};
}
