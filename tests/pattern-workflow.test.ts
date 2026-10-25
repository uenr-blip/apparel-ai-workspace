import { beforeEach,describe,expect,it } from "vitest";
import { IDS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { emptyQuote,emptyFeedback } from "@/lib/pattern-workflow";
import { getPatternBoard,savePatternDraft,patternCommand,previewPatternReference,getFactorySample,findPatternReferences,canFactorySeeSheetImage } from "@/server/services/pattern-workflow";
import { draftContext,publishContext } from "@/server/context/context-service";
import { runBusinessAgent } from "@/server/agents/business-agent";
import { storeSheetImage } from "@/server/services/sheet-image";
import { resetDatabase } from "./helpers";
const sales={organizationId:IDS.orgDemo,userId:IDS.userSales,role:"salesperson",factoryId:null};
const manager={...sales,userId:IDS.userManager,role:"manager"};
const factory={...sales,userId:IDS.userFactory,role:"factory",factoryId:IDS.factoryYunshan};
const key=()=>crypto.randomUUID();
async function create(id:string,legacy=false){return prisma.developmentProject.create({data:{id,organizationId:IDS.orgDemo,code:`DEV-${id}`,name:id,status:"open",unknownsJson:"[]",...(legacy?{craftFamily:"sweater",sheetJson:JSON.stringify({sweater:{yarnComposition:"原纱",yarnCount:"2/48",bodyStructure:"平针",yarnPrice:"内部价格777"}})}:{})}});}
async function save(projectId:string,fields:object={},references?:unknown){const b=await getPatternBoard(sales,projectId);return savePatternDraft(sales,{projectId,idempotencyKey:key(),expectedUpdatedAt:b.updatedAt,contextStamp:b.contextStamp,craftFamily:"sweater",sweater:{...b.content.sweater,...fields},fabric:b.content.fabric,origin:b.content.origin,originNote:b.content.originNote,...(references?{references}:{})});}
async function command(projectId:string,input:object,actor=sales,stamp?:string){const b=await getPatternBoard(actor,projectId);return patternCommand(actor,projectId,{idempotencyKey:key(),expectedUpdatedAt:stamp??b.updatedAt,contextStamp:b.contextStamp,confirmed:true,...input});}
async function freeze(projectId:string){await command(projectId,{action:"freeze",reason:"本轮打样要求"});return (await getPatternBoard(sales,projectId)).revisions[0];}
async function prepared(projectId:string,revisionId:string,factoryId=IDS.factoryYunshan,actor=sales){await command(projectId,{action:"create_sample",revisionId,factoryId,quantity:1,dueDate:"2026-10-01",requirements:"按本版要求核对"},actor);return (await getPatternBoard(actor,projectId)).samples[0];}
beforeEach(resetDatabase);
describe("版单部分引用与多厂打样",()=>{
  it("旧版单首次修改先留历史快照；V2换纱和类型不覆盖V1；每次写入完整审计",async()=>{
    await create("legacy",true);const count=await prisma.style.count();
    await save("legacy",{yarnComposition:"新纱"});let b=await getPatternBoard(sales,"legacy");
    expect(b.revisions).toHaveLength(1);expect(b.revisions[0].content.sweater.yarnComposition).toBe("原纱");
    const v1=b.revisions[0];const v2=await freeze("legacy");expect(v2.number).toBe(2);expect(v2.parentId).toBe(v1.id);expect(v2.content.sweater.yarnComposition).toBe("新纱");
    await command("legacy",{action:"revise",revisionId:v1.id,reason:"从原版做针织方案"});b=await getPatternBoard(sales,"legacy");
    await savePatternDraft(sales,{projectId:"legacy",idempotencyKey:key(),expectedUpdatedAt:b.updatedAt,craftFamily:"knit",sweater:b.content.sweater,fabric:{fabricComposition:"棉"}});const v3=await freeze("legacy");
    expect(v3.parentId).toBe(v1.id);expect(v3.content.craftFamily).toBe("knit");expect((await getPatternBoard(sales,"legacy")).revisions.find(r=>r.id===v1.id)?.content.sweater.yarnComposition).toBe("原纱");
    expect(await prisma.style.count()).toBe(count);expect(await prisma.patternSample.count()).toBe(0);
    const audits=await prisma.auditEvent.findMany({where:{entityId:"legacy"}});expect(audits.length).toBeGreaterThan(3);expect(audits.every(a=>a.actorUserId===sales.userId&&a.createdAt&&Object.hasOwn(JSON.parse(a.payloadJson!),"before")&&Object.hasOwn(JSON.parse(a.payloadJson!),"after"))).toBe(true);
  });
  it("图片只作说明；引用只填选中字段并允许改本次值，来源更新不覆盖已采用版本",async()=>{
    await create("source");await save("source",{yarnComposition:"来源羊毛",yarnCount:"2/48",bodyStructure:"平针"});const source=await freeze("source");
    await create("target");await save("target",{yarnComposition:"本款棉",yarnCount:"原支数",bodyStructure:"原组织"});
    const p=await previewPatternReference(sales,{projectId:"target",sourceRevisionId:source.id,mode:"fields",fields:["sweater.yarnCount"],scope:"只参考支数",exclusions:"不参考成分和组织",values:{"sweater.yarnCount":"人工改为2/32"}},key());
    expect((await getPatternBoard(sales,"target")).content.sweater.yarnCount).toBe("原支数");
    const request={action:"apply_reference",proposalId:p.proposalId,expectedUpdatedAt:p.updatedAt,contextStamp:p.contextStamp,confirmed:true,idempotencyKey:key()};
    await patternCommand(sales,"target",request);expect(await patternCommand(sales,"target",request)).toEqual(expect.objectContaining({projectId:"target"}));
    let b=await getPatternBoard(sales,"target");expect(b.content.sweater).toMatchObject({yarnComposition:"本款棉",yarnCount:"人工改为2/32",bodyStructure:"原组织"});expect(b.content.references[0].sourceValues["sweater.yarnCount"]).toBe("2/48");
    await save("source",{yarnCount:"来源新版支数"});await freeze("source");expect((await getPatternBoard(sales,"target")).content.sweater.yarnCount).toBe("人工改为2/32");
    const image=await storeSheetImage(IDS.orgDemo,Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10]));
    const ref={id:"image-reference",kind:"image",sourceRevisionId:"",images:[image.imageSrc],label:"外部实物",scope:"只参考领口",exclusions:"不参考纱线",mode:"note",fields:[]};
    await save("target",{},[ref]);b=await getPatternBoard(sales,"target");expect(b.content.references[0].images).toEqual([image.imageSrc]);expect(b.content.sweater.yarnComposition).toBe("本款棉");
    await expect(save("target",{},[{...ref,mode:"fields",fields:["sweater.yarnComposition"]}])).rejects.toThrow(/不能凭图片/);
    await expect(save("target",{},[{...ref,images:["https://example.test/private.jpg"]}])).rejects.toThrow();
  });
  it("同一V1可交两厂，负责人发厂与回执隔离，A改V2不影响B且工厂包不泄露内部报价",async()=>{
    await create("multi",true);const v1=await freeze("multi");
    await prisma.party.create({data:{id:"factory-b",organizationId:IDS.orgDemo,code:"FACTORY-B",name:"B工厂",kind:"factory",demoNote:"test"}});
    const a=await prepared("multi",v1.id),b=await prepared("multi",v1.id,"factory-b");
    const privateImage=await storeSheetImage(IDS.orgDemo,Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10]));
    await save("multi",{imagePath:privateImage.imageSrc});const privateVersion=await freeze("multi");const bPrivate=await prepared("multi",privateVersion.id,"factory-b");await command("multi",{action:"issue_sample",sampleId:bPrivate.id},sales,bPrivate.updatedAt);
    expect(await canFactorySeeSheetImage(factory,privateImage.imageSrc.split("/").at(-1)!)).toBe(false);
    await expect(getFactorySample(factory,"multi",a.id)).rejects.toThrow();
    await command("multi",{action:"issue_sample",sampleId:a.id},sales,a.updatedAt);
    await expect(getFactorySample(factory,"multi",b.id)).rejects.toThrow();
    const packet=await getFactorySample(factory,"multi",a.id);expect(JSON.stringify(packet)).not.toMatch(/内部价格777|quoteJson|internalOpinion|ownerId|sourceLabel/);
    await patternCommand(factory,"multi",{action:"receive_sample",sampleId:a.id,idempotencyKey:key()});
    let board=await getPatternBoard(sales,"multi");const current=board.samples.find(s=>s.id===a.id)!;
    await command("multi",{action:"update_sample",sampleId:a.id,quote:{...emptyQuote(),sampleFee:"300",unitPrice:"62",currency:"CNY",basis:"同纱同工艺",bulkQuantity:"1000"},feedback:{...emptyFeedback(),returnedOn:"2026-10-01",review:"rework",reviewNote:"领口不平，建议换纱"},internalOpinion:"内部比价"},sales,current.updatedAt);
    await save("multi",{yarnComposition:"V2新纱"});const v2=await freeze("multi");await prepared("multi",v2.id);
    board=await getPatternBoard(sales,"multi");expect(board.samples.find(s=>s.id===b.id)?.revisionId).toBe(v1.id);expect(board.samples.filter(s=>s.factoryId===IDS.factoryYunshan).map(s=>s.round).sort()).toEqual([1,2]);
    expect(board.samples.find(s=>s.id===a.id)?.receivedAt).toBeTruthy();expect(board.samples.find(s=>s.id===b.id)?.feedback.review).toBe("pending");
    const a2=board.samples.find(s=>s.factoryId===IDS.factoryYunshan&&s.round===2)!;await command("multi",{action:"issue_sample",sampleId:a2.id},sales,a2.updatedAt);
    expect(await canFactorySeeSheetImage(factory,privateImage.imageSrc.split("/").at(-1)!)).toBe(true);
  });
  it("谁负责谁发，与经理身份无关；换负责人、过期确认、并发与重复请求受校验",async()=>{
    await create("owner");await save("owner",{yarnComposition:"羊毛"});const v=await freeze("owner"),s=await prepared("owner",v.id);
    await expect(command("owner",{action:"issue_sample",sampleId:s.id},manager,s.updatedAt)).rejects.toThrow(/负责人/);
    await command("owner",{action:"reassign_sample",sampleId:s.id,ownerId:manager.userId,reason:"实际负责人接手"},sales,s.updatedAt);
    await expect(command("owner",{action:"issue_sample",sampleId:s.id},sales,s.updatedAt)).rejects.toThrow(/负责人/);
    await expect(command("owner",{action:"issue_sample",sampleId:s.id},manager,s.updatedAt)).rejects.toThrow(/已变化/);
    const b=await getPatternBoard(manager,"owner"),fresh=b.samples[0];const input={action:"issue_sample",sampleId:s.id,confirmed:true,expectedUpdatedAt:fresh.updatedAt,contextStamp:b.contextStamp,idempotencyKey:key()};
    const result=await patternCommand(manager,"owner",input);expect(await patternCommand(manager,"owner",input)).toEqual(result);
    const stamp=(await getPatternBoard(sales,"owner")).updatedAt;
    const results=await Promise.allSettled(["A","B"].map(value=>savePatternDraft(sales,{projectId:"owner",expectedUpdatedAt:stamp,idempotencyKey:key(),craftFamily:"sweater",sweater:{yarnComposition:value}})));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    await prisma.user.update({where:{id:sales.userId},data:{active:false}});await expect(getPatternBoard(sales,"owner")).rejects.toThrow(/无权/);
  });
  it("规则或目标改变后旧采用提案不能执行；组织隔离且不能多选来源覆盖同一字段",async()=>{
    await create("src");await save("src",{yarnCount:"2/48"});const src=await freeze("src");await create("dst");await save("dst",{yarnCount:"原值"});
    const p=await previewPatternReference(sales,{projectId:"dst",sourceRevisionId:src.id,mode:"fields",fields:["sweater.yarnCount"],scope:"支数",exclusions:"其他"},key());
    const policy=await draftContext(manager,{scope:"development",title:"新版单核对",text:"发厂前由实际负责人核对完整要求。",source:"隔离测试",baseId:null,idempotencyKey:key()});await publishContext(manager,policy.proposalId,true);
    await expect(patternCommand(sales,"dst",{action:"apply_reference",proposalId:p.proposalId,expectedUpdatedAt:p.updatedAt,contextStamp:p.contextStamp,idempotencyKey:key(),confirmed:true})).rejects.toThrow(/规则已更新/);
    expect((await getPatternBoard(sales,"dst")).content.sweater.yarnCount).toBe("原值");
    await expect(getPatternBoard({...sales,organizationId:IDS.orgIso},"dst")).rejects.toThrow();
    const fresh=await previewPatternReference(sales,{projectId:"dst",sourceRevisionId:src.id,mode:"fields",fields:["sweater.yarnCount"],scope:"支数",exclusions:"其他"},key());
    await save("dst",{yarnCount:"同事更新"});
    await expect(patternCommand(sales,"dst",{action:"apply_reference",proposalId:fresh.proposalId,expectedUpdatedAt:fresh.updatedAt,contextStamp:fresh.contextStamp,idempotencyKey:key(),confirmed:true})).rejects.toThrow(/资料已变化/);
    await expect(command("dst",{action:"freeze",reason:"伪造确认",confirmed:false})).rejects.toThrow();
    await expect(command("dst",{action:"freeze",reason:"伪造身份",ownerId:manager.userId})).rejects.toThrow();
    const r={id:"ref-one",kind:"revision",sourceRevisionId:src.id,label:"来源",scope:"支数",exclusions:"",mode:"fields",fields:["sweater.yarnCount"],images:[]};await expect(save("dst",{},[r,{...r,id:"ref-two"}])).rejects.toThrow(/多个引用来源/);
  });
  it("产品问衣据可自行查目标、来源并准备部分参考，确认前不改业务，不允许猜ID",async()=>{
    const project=await create("agent-target");await save(project.id,{yarnComposition:"原成分",yarnCount:"原支数"});await create("agent-source");await save("agent-source",{yarnCount:"2/48"});const source=await freeze("agent-source");
    let step=0;const calls=[{name:"pattern_find_projects",args:{query:project.code}},{name:"pattern_read_board",args:{projectId:project.id}},{name:"pattern_find_sources",args:{query:"agent-source"}},{name:"pattern_prepare_reference",args:{projectId:project.id,sourceRevisionId:source.id,mode:"fields",fields:["sweater.yarnCount"],scope:"只参考支数",exclusions:"其他不变"}}];
    const result=await runBusinessAgent(sales,"product",`给 ${project.code} 参考来源的支数，其他不变`,async()=>{const call=calls[step++];return call?{content:null,tool_calls:[{id:`call-${step}`,type:"function",function:{name:call.name,arguments:JSON.stringify(call.args)}}]}:{content:"已列出部分参考，等待核对与确认。"};});
    expect(result.patternSuggestion?.fields).toEqual(["sweater.yarnCount"]);expect((await getPatternBoard(sales,project.id)).content.sweater.yarnCount).toBe("原支数");expect(result.tables.some(t=>t.title.includes("各厂打样比较"))).toBe(true);
    expect((await findPatternReferences(sales,"agent-source")).candidates[0].id).toBe(source.id);
    const {patternTools}=await import("@/server/agents/pattern-tools");const tools=patternTools(sales);
    await expect(tools.tools.find(t=>t.name==="prepare_reference")!.run({projectId:project.id,sourceRevisionId:source.id,mode:"fields",fields:["sweater.yarnCount"],scope:"猜对象",exclusions:"其他"})).rejects.toThrow();
  });
});
