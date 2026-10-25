"use client";
import { useRef,useState } from "react";
import { Button } from "@/components/ui/button";
import { AgentResultTable } from "./agent-result-table";
import { PATTERN_FIELDS,type PatternField,type PatternSuggestion } from "@/lib/pattern-workflow";
import type { previewPatternReference } from "@/server/services/pattern-workflow";
type Preview=Awaited<ReturnType<typeof previewPatternReference>>;
export function PatternReferenceSuggestion({suggestion}:{suggestion:PatternSuggestion}){
  const [scope,setScope]=useState(suggestion.scope),[exclusions,setExclusions]=useState(suggestion.exclusions),[fields,setFields]=useState(suggestion.fields),[values,setValues]=useState<Partial<Record<PatternField,string>>>({}),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[done,setDone]=useState(false);
  const request=useRef<{body:string;key:string}|null>(null);
  async function send(confirm=false){setBusy(true);setError("");try{const payload=confirm&&preview?{action:"apply_reference",proposalId:preview.proposalId,expectedUpdatedAt:preview.updatedAt,contextStamp:preview.contextStamp,confirmed}:{request:{...suggestion,scope,exclusions,fields:suggestion.mode==="fields"?fields:[],values}};
    const body=JSON.stringify(payload);if(request.current?.body!==body)request.current={body,key:crypto.randomUUID()};
    const r=await fetch(confirm?`/api/projects/${suggestion.projectId}/pattern-workflow`:"/api/projects/pattern-assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,idempotencyKey:request.current.key})});const data=await r.json();if(!r.ok)throw new Error(data.error);if(confirm){setDone(true);}else{setPreview(data);setConfirmed(false);}}
    catch(e){setError(e instanceof Error?e.message:"本次未完成");}finally{setBusy(false);}}
  if(done)return <div className="rounded-xl border border-[var(--line)] p-4 text-sm"><p>参考已保存到本款草稿，尚未留为新版或发厂。</p><a className="underline" href={`/projects/${suggestion.projectId}`}>重新打开已保存版单，继续核对版本与工厂打样</a></div>;
  const inputClass="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--field-solid)] p-2";
  return <section className="space-y-3 rounded-xl border border-[var(--line)] p-4 text-sm" onChange={()=>{setConfirmed(false);setPreview(null);}}><p className="font-medium">部分参考建议 · 可以修改后再预览</p><fieldset disabled={busy} className="space-y-3"><label className="block">参考哪些<input className={inputClass} maxLength={400} value={scope} onChange={e=>setScope(e.target.value)}/></label><label className="block">不参考哪些<input className={inputClass} maxLength={400} value={exclusions} onChange={e=>setExclusions(e.target.value)}/></label>
    {suggestion.mode==="fields"&&suggestion.fields.map(f=><div key={f}><label className="flex gap-2"><input type="checkbox" checked={fields.includes(f)} onChange={e=>{setFields(e.target.checked?[...fields,f]:fields.filter(k=>k!==f));if(!e.target.checked)setValues(Object.fromEntries(Object.entries(values).filter(([key])=>key!==f)));}}/>{PATTERN_FIELDS[f]}</label>{fields.includes(f)&&<input aria-label={`${PATTERN_FIELDS[f]}本次值`} className={inputClass} value={values[f]??""} placeholder="默认采用来源值；在预览中核对，填写可替换" maxLength={400} onChange={e=>{const next={...values};if(e.target.value)next[f]=e.target.value;else delete next[f];setValues(next);}}/>}</div>)}
    <Button type="button" variant="outline" disabled={busy||!scope.trim()} onClick={()=>void send()}>核对采用预览</Button></fieldset>
    {preview&&<><AgentResultTable table={{title:`${preview.projectCode} · 拟采用的改动`,columns:["项目","当前值","拟采用值"],rows:preview.changes.map(c=>({cells:[c.label,c.before||"未填",c.after||"清空"]})),emptyMessage:"无字段变化，仍请核对参考说明"}}/><label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>{e.stopPropagation();setConfirmed(e.target.checked);}}/>我已核对目标款和全部改动，确认只写入当前草稿，不发厂、不批准、不采购。</label><Button type="button" disabled={busy||!confirmed} onClick={()=>void send(true)}>确认采用到本款草稿</Button></>}
    {error&&<p role="alert" className="text-[var(--danger)]">{error}</p>}
  </section>;
}
