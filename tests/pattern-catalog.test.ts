import { beforeEach, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { IDS } from "@/lib/constants";
import { referenceInput, type PatternReference, type PatternField } from "@/lib/pattern-workflow";
import type { PatternCatalogSource } from "@/lib/pattern-catalog";
import { searchPatternCatalog, getPatternCatalogSource } from "@/server/services/pattern-catalog";
import { getPatternBoard, patternCommand, previewPatternReference, savePatternDraft } from "@/server/services/pattern-workflow";
import { replaceStyleImage } from "@/server/services/style-image";
import { readSheetImage } from "@/server/services/sheet-image";
import { resetDatabase } from "./helpers";

const sales = { organizationId: IDS.orgDemo, userId: IDS.userSales, role: "salesperson", factoryId: null };
beforeEach(resetDatabase);
async function project(id:string, family="sweater", sheet:object={}) {
  return prisma.developmentProject.create({data:{id,organizationId:IDS.orgDemo,code:`DEV-${id}`,name:`毛衣 ${id}`,status:"open",unknownsJson:"[]",craftFamily:family,sheetJson:JSON.stringify(sheet)}});
}
function reference(s:PatternCatalogSource, fields:PatternField[] = s.fields):PatternReference {
  return {id:crypto.randomUUID(),kind:"catalog",sourceRevisionId:"",label:s.label.slice(0,400),sourceLabel:s.label,sourceValues:{},images:[],scope:"只参考选中参数",exclusions:"其他沿用本款",mode:fields.length?"fields":"note",fields,catalog:{sourceId:s.sourceId,materialId:s.materialId,fingerprint:s.fingerprint,includeImage:false}};
}
async function save(id:string, refs:PatternReference[], fields:object={}, family="sweater") {
  const b=await getPatternBoard(sales,id);
  return savePatternDraft(sales,{projectId:id,idempotencyKey:crypto.randomUUID(),expectedUpdatedAt:b.updatedAt,contextStamp:b.contextStamp,craftFamily:family,sweater:family==="sweater"?{...b.content.sweater,...fields}:b.content.sweater,fabric:family!=="sweater"?{...b.content.fabric,...fields}:b.content.fabric,references:refs.map(referenceInput)});
}

it("款式库可空查询、单字和部分编号查找；真实用户与公司隔离", async()=>{
  await project("021");await project("022");
  expect((await searchPatternCatalog(sales,"")).items.length).toBeGreaterThan(0);
  expect((await searchPatternCatalog(sales,"毛")).items.map(i=>i.label)).toEqual(expect.arrayContaining(["DEV-021 毛衣 021","DEV-022 毛衣 022"]));
  expect((await searchPatternCatalog(sales,"DEV-02")).items).toHaveLength(2);
  const before=await prisma.auditEvent.count();await getPatternCatalogSource(sales,"project:021");expect(await prisma.auditEvent.count()).toBe(before);
  await expect(searchPatternCatalog({...sales,userId:IDS.userFactory,role:"factory",factoryId:IDS.factoryYunshan},"")).rejects.toThrow(/无权/);
  await expect(getPatternCatalogSource({...sales,organizationId:IDS.orgIso,userId:IDS.userIso},"project:021")).rejects.toThrow(/无权/);
});

it("未留档开发款可带入并人工改值；固定来源快照且不改原款、不新增原版次，写入含审计",async()=>{
  const original=await project("source","sweater",{sweater:{yarnComposition:"羊毛",yarnCount:"2/48",yarnPrice:"999",yarnSupplier:"内部厂家"}});
  await project("target","sweater",{sweater:{bodyStructure:"本款组织"}});
  const source=await getPatternCatalogSource(sales,"project:source"),ref=reference(source);
  expect(source.sourceId).toBe("draft:source");expect(JSON.stringify(source)).not.toMatch(/999|内部厂家/);
  await save("target",[ref],{yarnComposition:"棉（人工改）",yarnCount:"2/48"});
  let b=await getPatternBoard(sales,"target");
  expect(b.content.sweater).toMatchObject({yarnComposition:"棉（人工改）",yarnCount:"2/48",bodyStructure:"本款组织",yarnPrice:""});
  expect(b.content.references[0].sourceValues["sweater.yarnComposition"]).toBe("羊毛");
  expect(await prisma.developmentProject.findUnique({where:{id:"source"}})).toEqual(original);
  expect(await prisma.patternRevision.count({where:{projectId:"source"}})).toBe(0);
  await prisma.developmentProject.update({where:{id:"source"},data:{sheetJson:JSON.stringify({sweater:{yarnComposition:"原款后来改为涤纶"}})}});
  await save("target",b.content.references,{yarnCount:"2/32"});b=await getPatternBoard(sales,"target");
  expect(b.content.references[0].sourceValues["sweater.yarnComposition"]).toBe("羊毛");
  const a=await prisma.auditEvent.findFirstOrThrow({where:{entityId:"target",action:"development.pattern_saved"},orderBy:{createdAt:"desc"}}),payload=JSON.parse(a.payloadJson!);
  expect(a.actorUserId).toBe(sales.userId);expect(a.createdAt).toBeTruthy();expect(payload.before.sweater.yarnCount).toBe("2/48");expect(payload.after.sweater.yarnCount).toBe("2/32");
  expect(payload.after.references[0].catalog.fingerprint).toBe(source.fingerprint);
  await project("agent-source","sweater",{sweater:{needleType:"12针"}});
  const aBoard=await getPatternBoard(sales,"agent-source");
  await patternCommand(sales,"agent-source",{action:"freeze",reason:"智能体参考",confirmed:true,idempotencyKey:crypto.randomUUID(),expectedUpdatedAt:aBoard.updatedAt,contextStamp:aBoard.contextStamp});
  const version=(await getPatternBoard(sales,"agent-source")).revisions[0];
  const proposal=await previewPatternReference(sales,{projectId:"target",sourceRevisionId:version.id,mode:"fields",fields:["sweater.needleType"],scope:"只参考针型",exclusions:"其他不变"},crypto.randomUUID());
  await patternCommand(sales,"target",{action:"apply_reference",proposalId:proposal.proposalId,confirmed:true,idempotencyKey:crypto.randomUUID(),expectedUpdatedAt:proposal.updatedAt,contextStamp:proposal.contextStamp});
  const mixed=await getPatternBoard(sales,"target");expect(mixed.content.sweater.needleType).toBe("12针");expect(mixed.content.references[0].sourceValues["sweater.yarnComposition"]).toBe("羊毛");
});

it("过期、伪造、空字段、多来源和跨类型参考不能保存",async()=>{
  await project("source","sweater",{sweater:{yarnCount:"2/48"}});await project("target");
  const source=await getPatternCatalogSource(sales,"project:source"),ref=reference(source);
  await expect(save("target",[{...ref,fields:["sweater.bodyStructure"]}])).rejects.toThrow(/没有填写/);
  await expect(save("target",[ref],{},"knit")).rejects.toThrow(/不兼容/);
  await expect(save("target",[ref,{...ref,id:"other-ref"}])).rejects.toThrow(/多个引用来源/);
  await expect(save("target",[{...ref,catalog:{...ref.catalog!,fingerprint:"0".repeat(64)}}])).rejects.toThrow(/资料已变化/);
  await prisma.developmentProject.update({where:{id:"source"},data:{sheetJson:JSON.stringify({sweater:{yarnCount:"2/32"}})}});
  await expect(save("target",[ref])).rejects.toThrow(/资料已变化/);
  expect((await getPatternBoard(sales,"target")).content.references).toHaveLength(0);
});

it("正式留档来源可选V1/V2，不随当前草稿变化",async()=>{
  await project("versioned","sweater",{sweater:{yarnCount:"2/48"}});
  let b=await getPatternBoard(sales,"versioned");
  await patternCommand(sales,"versioned",{action:"freeze",reason:"确认留档",confirmed:true,idempotencyKey:crypto.randomUUID(),expectedUpdatedAt:b.updatedAt,contextStamp:b.contextStamp});
  const source=await getPatternCatalogSource(sales,"project:versioned");expect(source.label).toContain("版单 V1");expect(source.sourceId).toMatch(/^revision:/);
  await prisma.developmentProject.update({where:{id:"versioned"},data:{sheetJson:JSON.stringify({sweater:{yarnCount:"2/32"}})}});
  expect((await getPatternCatalogSource(sales,source.sourceId)).fingerprint).toBe(source.fingerprint);
  b=await getPatternBoard(sales,"versioned");expect(b.revisions[0].content.sweater.yarnCount).toBe("2/48");
});

it("款式主档只带明确材料字段，多材料不猜；图片固定后原款换图仍可读取",async()=>{
  const v=await prisma.styleVersion.findFirstOrThrow({where:{styleId:IDS.styleSt26018,status:"approved"},include:{bomLines:true}});
  const materialId=v.bomLines[0].materialId;
  await prisma.material.update({where:{id:materialId},data:{composition:"100%棉",gsm:"220",widthCm:"150"}});
  const bytes=Buffer.from([0x89,0x50,0x4e,0x47,13,10,26,10]);
  await replaceStyleImage({...sales,styleId:IDS.styleSt26018,bytes});
  const source=await getPatternCatalogSource(sales,`version:${v.id}`);
  expect(source.fields).toContain("fabric.fabricComposition");expect(source.content.fabric.fabricComposition).toBe("100%棉");expect(source.content.craftFamily).toBe("");
  const ref=reference(source);ref.catalog!.includeImage=true;
  await project("target","knit");await save("target",[ref],{fabricComposition:"本次人工修改"},"knit");
  const b=await getPatternBoard(sales,"target"),image=b.content.references[0].images[0];expect(image).toMatch(/^\/api\/sheet-images\/catalog-/);
  await replaceStyleImage({...sales,styleId:IDS.styleSt26018,bytes:Buffer.from([0xff,0xd8,0xff,0xe0])});
  expect((await readSheetImage(sales.organizationId,image.split("/").at(-1)!)).bytes.equals(bytes)).toBe(true);
  await prisma.material.update({where:{id:materialId},data:{composition:"来源已改"}});
  await save("target",b.content.references,{gsm:"240"},"knit");
  expect((await getPatternBoard(sales,"target")).content.references[0].sourceValues["fabric.fabricComposition"]).toBe("100%棉");
  await prisma.material.create({data:{id:"catalog-second-material",organizationId:IDS.orgDemo,code:"SECOND",name:"第二种面料",kind:"fabric",specSummary:"",unit:"m",demoNote:"隔离测试"}});
  await prisma.bomLine.create({data:{id:"catalog-second-bom",styleVersionId:v.id,materialId:"catalog-second-material",consumption:"1",unit:"m",includesAllowance:false,allowanceRate:"0",colorScope:"all",confirmed:true}});
  const multi=await getPatternCatalogSource(sales,`version:${v.id}`);expect(multi.fields).toHaveLength(0);expect(multi.materialId).toBe("");expect(multi.materials).toHaveLength(2);
  expect((await getPatternCatalogSource(sales,`version:${v.id}`,materialId)).content.fabric.fabricComposition).toBe("来源已改");
  await expect(getPatternCatalogSource(sales,`version:${v.id}`,"not-on-bom")).rejects.toThrow(/不属于/);
});
