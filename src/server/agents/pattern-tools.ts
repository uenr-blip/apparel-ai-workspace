import { getPatternHandoff } from "@/server/services/pattern-handoff";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { TradeActor } from "@/server/services/trade-contract";
import { authorizePattern,findPatternReferences,getPatternBoard,factoryPatternContent } from "@/server/services/pattern-workflow";
import { PATTERN_FIELDS,PatternReferenceRequest,type PatternSuggestion } from "@/lib/pattern-workflow";
import type { AgentTable } from "@/lib/agent-table";
import type { BusinessToolRegistry,EvidenceCard } from "./business-tools";
import type { AgentTool } from "./runtime";
export function patternTools(actor:TradeActor):BusinessToolRegistry {
  const tables:AgentTable[]=[],cards:EvidenceCard[]=[],projects=new Set<string>(),sources=new Set<string>();let read=false,suggestion:PatternSuggestion|null=null;
  const tool=(name:string,description:string,parameters:Record<string,unknown>,run:AgentTool["run"]):AgentTool=>({name,description,parameters,run:async args=>{await authorizePattern(actor);return run(args);}});
  const querySchema={type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false};
  const tools:AgentTool[]=[
    tool("find_projects","查找当前组织的开发款式，准备查版单和多厂打样；不要用正式款式ID冒充开发ID",querySchema,async raw=>{
      const{query}=z.object({query:z.string().trim().min(1).max(100)}).strict().parse(raw);projects.clear();
      const rows=await prisma.developmentProject.findMany({where:{organizationId:actor.organizationId,OR:[{code:{contains:query}},{name:{contains:query}},{style:{code:{contains:query}}}]},select:{id:true,code:true,name:true},take:21});
      if(rows.length===1)projects.add(rows[0].id);
      tables.push({title:`开发版单匹配 · ${query}`,columns:["编号","开发款式","核对状态"],rows:rows.slice(0,20).map(r=>({href:`/projects/${r.id}`,cells:[r.code,r.name,rows.length===1?"唯一匹配":"请补充唯一编号"]})),emptyMessage:"没有匹配的开发版单，请补充开发编号或先建档。",notes:rows.length>20?["仅显示前20款，请缩小范围"]:[]});
      return{candidates:rows.slice(0,20),requiresClarification:rows.length!==1};
    }),
    tool("read_board","读已查到的唯一开发款式的当前版单、固定版本、各厂报价和回样（只读）",{type:"object",properties:{projectId:{type:"string"}},required:["projectId"],additionalProperties:false},async raw=>{
      const{projectId}=z.object({projectId:z.string()}).strict().parse(raw);if(!projects.has(projectId))throw new Error("先唯一查明开发款式，不能猜编号");
      const board=await getPatternBoard(actor,projectId);read=true;
      tables.push({title:`${board.code} · 版次记录`,columns:["版次","修改说明","留档人","留档时间"],rows:board.revisions.slice(0,20).map(r=>({href:`/projects/${projectId}`,cells:[`V${r.number}`,r.reason,r.createdByName,r.createdAt]})),notes:["留档不是资料批准；首次历史留档不能还原更早未记录的修改。",...(board.revisions.length>20?["仅列最近20版"]:[])],emptyMessage:"当前仅有草稿，尚未留档版次。"});
      tables.push({title:`${board.code} · 各厂打样比较`,columns:["工厂","版次 / 轮次","打样费 / 大货单价","条件","回样 / 评价","负责人 / 交接"],rows:board.samples.slice(0,30).map(s=>({href:`/projects/${projectId}`,cells:[s.factoryName,`V${s.revisionNumber} / 第${s.round}次`,`${s.quote.currency} ${s.quote.sampleFee||"待报"} / ${s.quote.unitPrice||"待报"}`,`数量：${s.quote.bulkQuantity||"待补"}；${s.quote.basis||"条件待补"}`,`${s.feedback.returnedOn||"未回样"}；${s.feedback.reviewNote||"待评价"}`,`${s.ownerName}；${s.receivedAt?"工厂已收到":s.issuedAt?"已发厂待回执":"未发厂"}`]})),notes:["版次、用料、数量和费用范围不同不能直接比较最低价；评价是人工登记，不是图片自动质检。", "谁负责谁发，不能自动换大货工厂、采购或投产。",...(board.samples.length>30?["仅列最近30条打样记录"]:[])],emptyMessage:"尚无工厂打样记录。"});
      const handoff=await getPatternHandoff(actor,projectId);
      tables.push({title:`${board.code} · 回样交接`,columns:["选定依据","正式资料","交接人"],rows:handoff.records.map(r=>({href:`/styles/${handoff.styleId}`,cells:[`${r.snapshot.factoryName} V${r.snapshot.revisionNumber} 第${r.snapshot.round}轮`,`V${r.snapshot.versionNumber} ${r.status === "approved" ? "已批准" : "待核对"}`,r.snapshot.createdByName]})),notes:["由打样负责人在版单的回样交接入口核对后生成草稿，不自动批准、采购或更换生产工厂。"],emptyMessage:"尚未交接正式资料草稿。"});
      cards.push({title:board.code,href:`/projects/${projectId}`,facts:["版单版本与各厂打样轮次分开，已发厂内容不能覆盖。"]});
      return{projectId,code:board.code,current:factoryPatternContent(board.content),revisions:board.revisions.slice(0,20).map(r=>({id:r.id,number:r.number,reason:r.reason,content:factoryPatternContent(r.content)})),samples:board.samples.slice(0,30),handoffs:handoff.records,scope:"报价回样只读，未发厂、未写业务；如要部分参考可查来源后准备建议"};
    }),
    tool("find_sources","按开发编号/名称/关联款号查可引用的已留档版单，返回真实字段；没有留档不能猜参数",querySchema,async raw=>{
      const{query}=z.object({query:z.string().min(1).max(100)}).strict().parse(raw);const result=await findPatternReferences(actor,query);sources.clear();for(const r of result.candidates.slice(0,20))sources.add(r.id);
      tables.push({title:`参考版单 · ${query}`,columns:["来源","可查范围"],rows:result.candidates.slice(0,20).map(r=>({href:`/projects/${r.projectId}`,cells:[r.label,"只采用选中的字段；原资料不变"]})),notes:["最多显示20个来源版次。本工具只准备已留档版单的参考建议；未留档草稿、款式主档材料可到版单的“参考已有款”手动选取并核对。"],emptyMessage:"没有匹配的留档版次。"});
      return{candidates:result.candidates.slice(0,20).map(r=>({id:r.id,label:r.label,content:factoryPatternContent(r.content)})),unsaved:result.unsaved,limited:result.limited||result.candidates.length>20};
    }),
    tool("prepare_reference","准备部分参考建议；不写业务，由人改值/核对预览再确认采用",{type:"object",properties:{projectId:{type:"string"},sourceRevisionId:{type:"string"},mode:{type:"string",enum:["note","fields"]},fields:{type:"array",items:{type:"string",enum:Object.keys(PATTERN_FIELDS)}},scope:{type:"string"},exclusions:{type:"string"}},required:["projectId","sourceRevisionId","mode","fields","scope","exclusions"],additionalProperties:false},async raw=>{
      const parsed=PatternReferenceRequest.parse(raw);if(!projects.has(parsed.projectId)||!sources.has(parsed.sourceRevisionId))throw new Error("先核对目标开发款式和引用来源");
      if(parsed.mode==="fields"&&!parsed.fields.length||parsed.mode==="note"&&parsed.fields.length)throw new Error("请明确仅说明或选择具体字段");
      suggestion={projectId:parsed.projectId,sourceRevisionId:parsed.sourceRevisionId,mode:parsed.mode,fields:parsed.fields,scope:parsed.scope,exclusions:parsed.exclusions};return{suggestion,saved:false,next:"由用户核对或修改，生成预览并确认后才写入本款草稿；不发厂"};
    }),
  ];
  return{tools,tables,cards,hasEvidence:()=>read,getOrderResult:()=>null,getPatternSuggestion:()=>suggestion};
}
