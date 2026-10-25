import { StyleConstructionSummary } from "@/app/(app)/styles/style-construction-fields";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getFactorySample, PatternError } from "@/server/services/pattern-workflow";
import { PATTERN_FIELDS, type PatternField } from "@/lib/pattern-workflow";
import { AgentResultTable } from "@/components/agent-result-table";
import { PageHeader } from "@/components/ui/page-header";
import { CRAFT_LABEL, type CraftFamily } from "@/server/domain/craft-sheet";
import { SampleReceipt } from "@/app/(app)/projects/sample-receipt";
export default async function FactorySamplePage({params}:{params:Promise<{id:string;sampleId:string}>}) {
  const session=await requireSession(), {id,sampleId}=await params;
  let packet:Awaited<ReturnType<typeof getFactorySample>>;
  try{packet=await getFactorySample({organizationId:session.organizationId,userId:session.id,role:session.role,factoryId:session.factoryId},id,sampleId);}catch(e){if(e instanceof PatternError)notFound();throw e;}
  return <div className="space-y-5"><PageHeader title={`${packet.code} · V${packet.revisionNumber} 工厂打样要求`} eyebrow={`第${packet.round}次打样 · ${packet.issuedAt?"已在系统内发厂":"预览，尚未发厂"}`} actions={<Link className="underline text-sm" href={`/projects/${id}`}>返回版单</Link>}/>
    <AgentResultTable table={{title:"本次完整要求",columns:["项目","本次执行内容"],rows:[{cells:["版单类型",CRAFT_LABEL[packet.content.craftFamily as CraftFamily]]},{cells:["打样件数",packet.quantity]},{cells:["预计回样",packet.dueDate||"待确认"]},{cells:["补充说明",packet.requirements||"未另作说明"]},...packet.content.fields.map(f=>({cells:[PATTERN_FIELDS[f.key as PatternField],f.value||"待确认"]}))],emptyMessage:"没有可执行要求",notes:["请按本版的完整要求核对；如需改纱线或工艺，请向负责人反馈，不能直接沿用其他版本。"]}}/>
    {packet.materials ? <section><h3>本版面料、纱线、辅料与特殊工艺</h3><StyleConstructionSummary rows={packet.materials.rows} imageBaseUrl={`/api/workflow/stages/${packet.materials.stageId}/images/${packet.materials.revisionId}`} /></section> : null}
    {packet.content.imagePath&&<Image src={packet.content.imagePath} alt={packet.content.imageNote||"本款款式图"} width={480} height={480} unoptimized className="max-h-96 w-auto object-contain"/>}
    {packet.diff.length>0&&<AgentResultTable table={{title:"本次参数变化",columns:["项目","上一版","本版"],rows:packet.diff.map(f=>({cells:[PATTERN_FIELDS[f.key as PatternField] || ({craftFamily:"版单类型",imagePath:"款式图",imageNote:"图注",references:"参考范围"} as Record<string,string>)[f.key],(f.key === "craftFamily" ? CRAFT_LABEL[f.before as CraftFamily] : f.before)||"未填",(f.key === "craftFamily" ? CRAFT_LABEL[f.value as CraftFamily] : f.value)||"已清空"]})),emptyMessage:"参数未变"}}/>}
    {packet.content.references.map((r,i)=><section key={i} className="space-y-2 rounded-xl border border-[var(--line)] p-4"><p>参考范围：{r.scope}</p><p className="text-sm">不参考：{r.exclusions||"未另外注明"}</p><div className="flex flex-wrap gap-3">{r.images.map(src=><Image key={src} src={src} alt={r.scope} width={240} height={240} unoptimized className="object-contain"/>)}</div></section>)}
    <p className="text-sm text-[var(--ink-muted)]">{packet.receivedAt?`本厂确认收到：${packet.receivedAt}`:packet.issuedAt?`发厂记录：${packet.issuedAt}；等待工厂确认收到。`:"此页仅为工厂版预览，未向工厂开放。"}</p>
    {session.role==="factory"&&!packet.receivedAt&&<SampleReceipt projectId={id} sampleId={sampleId}/>}
  </div>;
}
