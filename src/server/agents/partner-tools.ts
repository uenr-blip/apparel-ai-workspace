import { z } from "zod";
import { searchBusiness } from "@/server/services/business-search";
import { getPartnerDossier, ORDER_GROUPS } from "@/server/services/partner-dossier";
import type { TradeActor } from "@/server/services/trade-contract";
import type { BusinessToolRegistry } from "./business-tools";
import type { AgentTable } from "@/lib/agent-table";
export function partnerTools(actor:TradeActor):BusinessToolRegistry {
 const tables:AgentTable[]=[],selected=new Map<string,"customer"|"factory"|"supplier">();let evidence=false;
 return {tables,cards:[],hasEvidence:()=>evidence,getOrderResult:()=>null,tools:[
  {name:"find_partner",description:"按客户、工厂或供应商名称/编号查唯一对象；不猜ID，不按同一种材料猜供应商订单",parameters:{type:"object",properties:{query:{type:"string"},kind:{type:"string",enum:["customer","factory","supplier"]}},required:["query","kind"],additionalProperties:false},run:async raw=>{
   const p=z.object({query:z.string().trim().min(1).max(100),kind:z.enum(["customer","factory","supplier"])}).strict().parse(raw);const result=await searchBusiness(actor,p.query,{kind:p.kind});selected.clear();if(result.total===1)selected.set(result.items[0].id,p.kind);
   tables.push({title:`业务伙伴匹配 · ${p.query}`,columns:["编号","名称","核对"],rows:result.items.map(i=>({href:i.href,cells:[i.code,i.name,result.total===1?"唯一匹配":"请补充唯一编号"]})),emptyMessage:"没有匹配的可见业务伙伴",notes:result.total>20?[`共${result.total}条，先列20条，请缩小范围`]:[]});return{candidates:result.items,total:result.total,requiresClarification:result.total!==1};
  }},
  {name:"read_partner",description:"读取已查明客户/工厂/供应商的订单、进展、品牌、供料及历史；只读，可指定范围和翻页",parameters:{type:"object",properties:{id:{type:"string"},group:{type:"string",enum:["active","draft","history","all"]},page:{type:"integer",minimum:1,maximum:1000}},required:["id","group","page"],additionalProperties:false},run:async raw=>{
   const p=z.object({id:z.string().min(1),group:z.enum(["active","draft","history","all"]),page:z.number().int().min(1).max(1000)}).strict().parse(raw),kind=selected.get(p.id);if(!kind)throw new Error("请先唯一查明业务伙伴，不能猜编号");
   const data=await getPartnerDossier(actor,kind,p.id,{group:p.group,page:p.page,receiptPage:p.page,samplePage:p.page});evidence=true;
   tables.push({title:`${data.partner.name} · 订单与进展`,columns:["订单 / 款式","交期","状态","登记产量（件）","待处理"],rows:data.orders.map(o=>({href:o.href,cells:[`${o.orderNo} · ${o.styles.join("、")}`,o.delivery,`${o.statusLabel} · ${o.readiness}`,`订单${o.ordered} / 投产${o.started} / 合格${o.good} / 出运${o.shipped}`,o.blockers.join("；")||"暂无已登记阻塞"]})),emptyMessage:"该范围没有已登记订单",notes:[`当前范围 ${ORDER_GROUPS[p.group]}，第${data.page}/${data.pageCount}页；草稿${data.totals.draft}、正在执行${data.totals.active}、已出完/已结束${data.totals.history}。`,...data.notes]});
   if(kind==="supplier")tables.push({title:`${data.partner.name} · 供料与退供`,columns:["凭证","材料 / 订单","收料日期","净收数量","状态"],rows:data.receipts.map(r=>({href:r.href,cells:[r.reference,`${r.materialCode} ${r.materialName} / ${r.orderNo}`,r.receivedOn,`${r.netQuantity} ${r.unit}`,r.status==="active"?"有效收料":"已冲销"]})),emptyMessage:"暂无明确的供料凭证",notes:[`第${data.receiptPage}/${data.receiptPages}页，共${data.receiptCount}笔。未绑定供应商的采购不可猜归属。`]});
   if(kind==="factory")tables.push({title:`${data.partner.name} · 打样`,columns:["开发款式","版次 / 轮次","数量","交接"],rows:data.samples.map(s=>({href:s.href,cells:[s.title,`V${s.version} / 第${s.round}次`,s.quantity,s.stage]})),emptyMessage:"暂无打样记录",notes:[`第${data.samplePage}/${data.samplePages}页，共${data.sampleCount}条。`]});
   return data;
  }},
 ]};
}
